(ns parser
  (:require ["path" :as path]
            ["fs" :as fs]
            [promesa.core :as p]
            [log :refer [log!]]))

(def RawImport (js/require "web-tree-sitter"))
(def ParserClass (or (.-Parser RawImport) (.. RawImport -default -Parser)))
(def LanguageClass (or (.-Language RawImport) (.. RawImport -default -Language)))
(def QueryClass (or (.-Query RawImport) (.. RawImport -default -Query)))

(defonce parser-ref (atom nil))

(defn init-parser! [context]
  (p/let [_ (.init ParserClass)
          ext-path (.-extensionPath context)
          resources-path (path/join ext-path "resources")

          wasm-path (path/join resources-path "tree-sitter-scheme.wasm")
          lang      (.load LanguageClass wasm-path)
                    _ (log! (js/JSON.stringify QueryClass))
          parser    (new ParserClass)

          scheme-query-path (path/join resources-path "highlights.scm")
          scheme-query-str  (fs/readFileSync scheme-query-path "utf8")

          guix-query-path   (path/join resources-path "guix-expanded.scm")
          guix-query-str    (fs/readFileSync guix-query-path "utf8")

          full-query-str    (str scheme-query-str 
                                 "\n" guix-query-str
                                 )
          ]

    (.setLanguage parser lang)

(try
  (let [query (new QueryClass lang full-query-str)]
    (aset parser "query" query)
    (reset! parser-ref parser)
    (log! "Query Loaded Successfully"))
  (catch :default e
    (log! (str "FATAL QUERY ERROR: " (.-message e)))))

    (reset! parser-ref parser)
    (log! "SUCCESS: Tree-sitter initialized with Guix queries.")))

