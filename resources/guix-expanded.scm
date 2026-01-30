((list
  .
  (symbol) @constructor
  (#any-of? @constructor 
    "package" 
    "origin" 
    "operating-system" 
    "home-environment"
    "user-account" 
    "file-system"
    "bootloader-configuration"
    "channel"))
 )

((list
  .
  (symbol) @keyword
  (#any-of? @keyword
    "define-module"
    "define-gexp-compiler"
    "define-record-type"
    "define-record-type*"
    "define-configuration"
    "define-public"
    "define*-public"))
 )

((list
  .
  (symbol) @function.macro
  (#any-of? @function.macro
    "modify-inputs"
    "modify-phases"
    "substitute*"
    "substitute-keyword-arguments"
    "with-directory-excursion"
    "wrap-program"
    "match-record"
    "parameterize"))
 )

(list
  (symbol) @_ctx
  (#eq? @_ctx "modify-phases")
  (list
    (symbol) @function.builtin
    (#any-of? @function.builtin "add-after" "add-before" "replace")))


(list
  (symbol) @_ctx
  (#eq? @_ctx "package")
  (list
    (symbol) @property
    (#any-of? @property 
       "name" "version" "source" "build-system" "arguments" 
       "inputs" "native-inputs" "propagated-inputs" 
       "synopsis" "description" "license" "home-page")))


((_) @macro 
 (#match? @macro "^#[:$~]"))

((symbol) @constant
 (#match? @constant "^%"))
 
 
((_) @variable
 (#match? @variable "^[a-zA-Z0-9_-]+$"))