(use-modules (ice-9 rdelim)
             (ice-9 pretty-print)
             (ice-9 match)
             (srfi srfi-1)
             (json))

(catch #t
  (lambda () (use-modules (guix gexp)))
  (lambda _ #f))
(define (smart-format form)
  (match form
    (('define-module name . args)
     (display "(define-module ")
     (write name)
     (newline)
     (let* ((use-modules '())
            (other-args '()))
      
       (let split-args ((rest args))
         (match rest
           (() #f)
           ((#:use-module m . tail)
            (set! use-modules (cons m use-modules))
            (split-args tail))
           ((key val . tail)
            (set! other-args (append other-args (list key val)))
            (split-args tail))))
       
       (let ((sorted-modules 
              (sort (delete-duplicates use-modules)
                    (lambda (a b)
                      (string<? (format #f "~a" a) 
                                (format #f "~a" b))))))
         
         (let print-others ((o other-args))
           (match o
             (() #f)
             ((key val . tail)
              (display "  ") (display key) (display " ") (write val) (newline)
              (print-others tail))))

         (for-each (lambda (m)
                     (display "  #:use-module ")
                     (write m)
                     (newline))
                   sorted-modules)
         (display ")"))))
    
    (_ (pretty-print form #:width 100))))


(define (read-all code)
  (call-with-input-string code
    (lambda (port)
      (let loop ((acc '()))
        (let ((form (catch 'read-error
                      (lambda () (read port))
                      (lambda (key . args) 
                        (throw 'custom-read-error (format #f "Read error at: ~a" args))))))
          (if (eof-object? form)
              (reverse acc)
              (loop (cons form acc))))))))

(define (handle-request req)
  (let ((lst (cond ((vector? req) (vector->list req))
                   ((list? req) req)
                   (else #f))))
    (match lst
      (("format" code)
       (catch #t
         (lambda ()
           (let ((forms (read-all code)))
             `((status . "ok")
               (result . ,(with-output-to-string
                              (lambda ()
                                (for-each (lambda (f) 
                                            (smart-format f)
                                            (newline)
                                            (newline))
                                          forms)))))))
         (lambda (key . args)
           `((status . "error") 
             (message . ,(format #f "Format error: ~a (~a)" key args))))))
      (other `((status . "error") (message . "Invalid request format"))))))

(let loop ()
  (let ((line (read-line)))
    (when (and line (not (eof-object? line)))
      (catch #t
        (lambda ()
          ;; FIX: Wrap the line string in a port
          (let* ((port (open-input-string line))
                 (req  (json->scm port))
                 (resp (handle-request req)))
            (display (scm->json-string resp))
            (newline)
            (force-output (current-output-port))))
        (lambda (key . args)
          (format (current-error-port) "GUILE CRASH: ~a ~s\n" key args)
          (display (scm->json-string 
                    `((status . "error") 
                      (error . ,(symbol->string key))
                      (details . ,(format #f "~a" args)))))
          (newline)
          (force-output (current-output-port))))
      (loop))))
