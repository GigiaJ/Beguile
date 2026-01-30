(use-modules (ice-9 match)
             (ice-9 rdelim)
             (json)
             (ice-9 threads)
             (ice-9 documentation)
             (ice-9 session)
             (ice-9 control)
             (ice-9 regex)
             (ice-9 vlist)
             (system vm program)
             (srfi srfi-1)
             (guix scripts style)
             (guix ui)
             (guix read-print))

(define (log-msg msg)
  (let ((port (current-error-port)))
    (display (string-append "[Server] " msg "\n") port)
    (force-output port)))

(define (format-signature proc proc-name)
  (catch #t
         (lambda ()
           (if (procedure? proc)
               (let ((args (procedure-arguments proc)))
                 (format #f "(~a ~a)" proc-name
                         (string-join (map symbol->string
                                           (or (assoc-ref args
                                                          'required)
                                               '())) " "))) proc-name))
         (lambda _
           proc-name)))

(define (resolve-path filename)
  (if (string-prefix? "/" filename) filename
      (search-path %load-path filename)))

(define (format-code code-str)
  (catch #t
         (lambda ()
           (call-with-output-string (lambda (out-port)
                                      (call-with-input-string code-str
                                                              (lambda (in-port)
                                                                (let loop
                                                                  ()
                                                                  (let ((expr (read-with-comments
                                                                               in-port)))
                                                                    (unless (eof-object?
                                                                             expr)
                                                                      (cond
                                                                        ((vertical-space?
                                                                          expr)
                                                                         (pretty-print-with-comments
                                                                          out-port
                                                                          expr
                                                                          #:format-vertical-space (lambda 
                                                                                                          (_)
                                                                                                    
                                                                                                    
                                                                                                    (vertical-space
                                                                                                     2))))

                                                                        (else (pretty-print-with-comments
                                                                               out-port
                                                                               expr
                                                                               #:format-vertical-space
                                                                               canonicalize-vertical-space)))

                                                                      (loop)))))))))
         (lambda (key . args)
           (log-msg (format #f "Formatting Failed: ~a" args)) #f)))

(define (module-name->path mod-name)
  (catch #t
         (lambda ()
           (let* ((str-list (map symbol->string mod-name))
                  (rel-path (string-join str-list "/"))
                  (full-path (search-path %load-path
                                          (string-append rel-path ".scm"))))
             full-path))
         (lambda _
           #f)))

(define (scan-imports code-str)
  (let ((port (open-input-string code-str))
        (modules '()))
    (catch #t
           (lambda ()
             (let loop
               ()
               (let ((expr (read port)))
                 (unless (eof-object? expr)
                   (match expr
                     (('use-modules args ...)
                      (set! modules
                            (append modules
                                    (map cleanup-spec args))))
                     (((quote define-module) name . rest) (let scan-opts
                                                            ((opts rest))
                                                            (match opts
                                                              ((#:use-module mod . rem)
                                                               (set! modules
                                                                     (cons (cleanup-spec
                                                                            mod)
                                                                      modules))
                                                               (scan-opts rem))
                                                              ((kw val . rem) (scan-opts
                                                                               rem))
                                                              (_ #f))))
                     (_ #f))
                   (loop)))))
           (lambda _
             #f)) modules))

(define (cleanup-spec spec)
  (if (and (pair? spec)
           (pair? (car spec)))
      (car spec) spec))

(define (get-location-for-obj obj)
  (cond
    ((procedure? obj)
     (let ((src (procedure-source obj)))
       (if (and src
                (string? (source-property src
                                          'filename)))
           ;; Interpreted/Source Property
           (let ((full-path (resolve-path (source-property src
                                                           'filename))))
             (if (and full-path
                      (file-exists? full-path))
                 `((file unquote full-path)
                   (line unquote
                         (source-property src
                                          'line))
                   (column unquote
                           (source-property src
                                            'column))) #f))
           ;; VM Programs
           (if (program? obj)
               (let ((sources (program-sources obj)))
                 (if (and (pair? sources)
                          (pair? (car sources)))
                     (let* ((entry (car sources))
                            (props (cdr entry))
                            (raw-file (assoc-ref props
                                                 'filename)))
                       (if (and raw-file
                                (string? raw-file))
                           (let ((full-path (resolve-path raw-file)))
                             (if (and full-path
                                      (file-exists? full-path))
                                 `((file unquote full-path)
                                   (line unquote
                                         (or (assoc-ref props
                                                        'line) 0))
                                   (column unquote
                                           (or (assoc-ref props
                                                          'column) 0))) #f))
                           #f)) #f)) #f))))
    (else #f)))

(define (try-getter-location context symbol imports)
  (let* ((getter-name (string-append context "-" symbol))
         (getter-sym (string->symbol getter-name)))
    (let loop
      ((mods imports))
      (if (null? mods) #f
          (let ((mod-name (car mods)))
            (catch #t
                   (lambda ()
                     (let* ((mod (resolve-interface mod-name))
                            (var (module-variable mod getter-sym)))
                       (if (and (variable? var)
                                (variable-bound? var))
                           (let ((loc (get-location-for-obj (variable-ref var))))
                             (if loc loc
                                 (let ((mod-file (module-name->path mod-name)))
                                   (if mod-file
                                       (begin
                                         (log-msg (format #f
                                                   "Fallback: Opening module file ~a"
                                                   mod-file))
                                         `((file unquote mod-file)
                                           (line . 0)
                                           (column . 0)))
                                       (loop (cdr mods))))))
                           (loop (cdr mods)))))
                   (lambda _
                     (loop (cdr mods)))))))))

(define (get-definition-location symbol-name code-str context-list)
  (let ((sym (string->symbol symbol-name))
        (imports (scan-imports code-str)))
    
    (log-msg (format #f "Def Lookup: ~a Context: ~a" sym context-list))

    (or
     ;; Context Guessing
     (and (list? context-list)
          (not (null? context-list))
          (let loop
            ((ctx context-list))
            (if (null? ctx) #f
                (let ((loc (try-getter-location (car ctx) symbol-name imports)))
                  (if loc loc
                      (loop (cdr ctx)))))))

     ;; Direct Lookup
     (let loop
       ((mods imports))
       (if (null? mods)
           (get-location-for-symbol sym
                                    (current-module))
           (let ((mod-name (car mods)))
             (catch #t
                    (lambda ()
                      (let* ((mod (resolve-interface mod-name))
                             (var (module-variable mod sym)))
                        (if (and (variable? var)
                                 (variable-bound? var))
                            (let ((loc (get-location-for-obj (variable-ref var))))
                              (if loc loc
                                  (let ((mod-file (module-name->path mod-name)))
                                    (if mod-file
                                        `((file unquote mod-file)
                                          (line . 0)
                                          (column . 0))
                                        (loop (cdr mods))))))
                            (loop (cdr mods)))))
                    (lambda _
                      (loop (cdr mods)))))))
     #f)))

(define (get-location-for-symbol sym mod)
  (let ((var (module-variable mod sym)))
    (if (and (variable? var)
             (variable-bound? var))
        (get-location-for-obj (variable-ref var)) #f)))

(define (try-getter-lookup context symbol imports)
  (let* ((getter-name (string-append context "-" symbol))
         (getter-sym (string->symbol getter-name)))
    (or (let loop
          ((mods imports))
          (if (null? mods) #f
              (let ((mod-name (car mods)))
                (catch #t
                       (lambda ()
                         (let* ((mod (resolve-interface mod-name))
                                (val (module-ref mod getter-sym)))
                           (let ((sig (format-signature val getter-name))
                                 (doc (object-documentation val)))
                             (format #f "**~a**\n\n~a\n\n(Defined in ~a)" sig
                                     (or doc "Field Accessor") mod-name))))
                       (lambda _
                         (loop (cdr mods)))))))
        (catch #t
               (lambda ()
                 (let ((val (module-ref (current-module) getter-sym)))
                   (let ((sig (format-signature val getter-name))
                         (doc (object-documentation val)))
                     (format #f "**~a**\n\n~a" sig
                             (or doc "Field Accessor")))))
               (lambda _
                 #f)))))

(define (get-docs-with-context symbol-name code-str context-list)
  (let ((sym (string->symbol symbol-name))
        (imports (scan-imports code-str)))
    (or (and (list? context-list)
             (not (null? context-list))
             (let loop
               ((ctx context-list))
               (if (null? ctx) #f
                   (let ((doc (try-getter-lookup (car ctx) symbol-name imports)))
                     (if doc doc
                         (loop (cdr ctx)))))))
        (let loop
          ((mods imports))
          (if (null? mods)
              (catch #t
                     (lambda ()
                       (let ((val (module-ref (current-module) sym)))
                         (format #f "**~a**\n\n~a"
                                 (format-signature val symbol-name)
                                 (object-documentation val))))
                     (lambda _
                       #f))
              (let ((mod-name (car mods)))
                (catch #t
                       (lambda ()
                         (let* ((mod (resolve-interface mod-name))
                                (val (module-ref mod sym)))
                           (format #f "**~a**\n\n~a\n\n(Found in ~a)"
                                   (format-signature val symbol-name)
                                   (or (object-documentation val)
                                       "No docstring.") mod-name)))
                       (lambda _
                         (loop (cdr mods))))))) "No documentation found.")))

(define (get-indent-info symbol-name)
  (if (or (string-prefix? "def" symbol-name)
          (string-prefix? "with-" symbol-name))
      '((style . "body"))
      '((style . "align"))))

(define (get-completions prefix)
  (if (or (not prefix)
          (string-null? prefix))
      '()
      (let ((pattern (string-append "^"
                                    (regexp-quote prefix)))
            (module (current-module)))
        (catch #t
               (lambda ()
                 (let ((names '()))
                   (module-for-each (lambda (sym var)
                                      (let ((s (symbol->string sym)))
                                        (if (string-match pattern s)
                                            (set! names
                                                  (cons s names))))) module)
                   (let ((sorted (sort (delete-duplicates names) string<?)))
                     (if (> (length sorted) 100)
                         (take sorted 100) sorted))))
               (lambda (key . args)
                 (log-msg (format #f "Crawl failed: ~a" args))
                 '())))))

(define (eval-code code-str module-str)
  "Eval not implemented")

(define (make-response id result)
  `((jsonrpc . "2.0") (id unquote id)
    (result unquote result)))

(define (handle-message json-obj)
  (let* ((id (assoc-ref json-obj "id"))
         (method (assoc-ref json-obj "method"))
         (params (assoc-ref json-obj "params")))
    (log-msg (format #f "Method: ~a" method))
    (match method
      ("beguile/getIndent" (make-response id
                                          (get-indent-info (assoc-ref params
                                                            "symbol"))))
      ("beguile/completion" (let ((prefix (assoc-ref params "prefix")))
                              (make-response id
                                             (get-completions (if (string?
                                                                   prefix)
                                                                  prefix "")))))
      ("beguile/eval" (make-response id
                                     (eval-code (assoc-ref params "code")
                                                (assoc-ref params "module"))))
      ("beguile/format" (let ((formatted (format-code (assoc-ref params "code"))))
                          (if formatted
                              (make-response id formatted)
                              (make-response id
                                             (assoc-ref params "code")))))
      ("beguile/hover" (make-response id
                                      (get-docs-with-context (assoc-ref params
                                                              "symbol")
                                                             (or (assoc-ref
                                                                  params
                                                                  "code") "")
                                                             (vector->list (assoc-ref
                                                                            params
                                                                            "context")))))
      ("beguile/definition" (make-response id
                                           (get-definition-location (assoc-ref
                                                                     params
                                                                     "symbol")
                                                                    (or (assoc-ref
                                                                         params
                                                                         "code")
                                                                        "")
                                                                    (let ((ctx
                                                                           (assoc-ref
                                                                            params
                                                                            "context")))
                                                                      (if (vector?
                                                                           ctx)
                                                                          (vector->list
                                                                           ctx)
                                                                          '())))))
      (_ (make-response id "Unknown Method")))))

(define (parse-port)
  (match (command-line)
    ((_ _ "--port" p)
     (string->number p))

    ((_ _ p)
     (string->number p))

    (_ (error "No port provided to server.scm"))))

(define (run-server port)
  (let ((s (socket PF_INET SOCK_STREAM 0)))
    (setsockopt s SOL_SOCKET SO_REUSEADDR 1)
    (bind s AF_INET INADDR_ANY port)
    (listen s 5)

    (display "(Beguile Server Ready)")
    (newline)
    (force-output)

    (log-msg (format #f "Listening on port ~a..." port))

    (while #t
           (let* ((client (accept s))
                  (client-port (car client)))
             (catch #t
                    (lambda ()
                      (let loop
                        ()
                        (let ((line (read-line client-port)))
                          (unless (eof-object? line)
                            (let* ((req (json-string->scm line))
                                   (resp (handle-message req))
                                   (resp-str (scm->json-string resp)))
                              (display resp-str client-port)
                              (newline client-port)
                              (force-output client-port)
                              (loop))))))
                    (lambda (key . args)
                      (log-msg (format #f "Crash: ~a ~a" key args))))
             (close client-port)))))

(run-server (parse-port))

