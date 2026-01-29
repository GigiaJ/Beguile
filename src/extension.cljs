(ns extension
  (:require [promesa.core :as p]
            ["vscode" :as vscode]
            ["path" :as path]
            ["child_process" :as cp]
            ["net" :as net]
            ["fs" :as fs]
            ["os" :as os]))

(defonce output-channel
  (.createOutputChannel (.-window vscode) "Beguile Logs"))

(defn log! [message]
  (.appendLine output-channel (str message)))

(defn get-free-port! []
  (let [deferred (p/deferred)
        server (.createServer net)]
    (.listen server 0
             (fn []
               (let [port (.-port (.address server))]
                 (.close server (fn []
                                  (p/resolve! deferred port))))))
    (.on server "error" (fn [err] (p/reject! deferred err)))
    deferred))

(def RawImport (js/require "web-tree-sitter"))
(def ParserClass (or (.-Parser RawImport) (.. RawImport -default -Parser)))
(defonce parser-ref (atom nil))

(defn init-parser! [context]
  (p/let [_ (.init ParserClass)
          ext-path (.-extensionPath context)
          wasm-path (path/join ext-path "resources" "tree-sitter-scheme.wasm")
          lang (.load (or (.-Language RawImport) (.. RawImport -default -Language))
                      wasm-path)
          parser (new ParserClass)]

    (.setLanguage ^js parser lang)
    (reset! parser-ref parser)
    (log! "SUCCESS: Tree-sitter initialized.")))

(defonce server-proc (atom nil))
(defonce client-socket (atom nil))
(defonce request-id (atom 0))
(defonce pending-requests (atom {}))
(defonce input-buffer (atom ""))

(defn send-request! [method params]
  (let [id (swap! request-id inc)
        payload (js/JSON.stringify
                 (clj->js {:jsonrpc "2.0"
                           :id id
                           :method method
                           :params params}))
        prom (p/deferred)]

    (if-let [sock @client-socket]
      (do
        (swap! pending-requests assoc id prom)
        (.write sock (str payload "\n"))
        prom)
      (p/rejected "No connection to Beguile server."))))

(defn connect-to-server! [port]
  (log! (str "Connecting to Guile on port " port "..."))
  (let [socket (net/createConnection port "127.0.0.1")]

    (.on socket "data"
         (fn [data]
           (swap! input-buffer str (.toString data))
           (let [raw @input-buffer]
             (when (clojure.string/includes? raw "\n")
               (let [parts (clojure.string/split raw #"\n" -1)]
                 (dotimes [i (dec (count parts))]
                   (let [line (nth parts i)]
                     (when-not (clojure.string/blank? line)
                       (try
                         (let [response (js/JSON.parse line)
                               id (.-id response)
                               result (.-result response)]
                           (when-let [resolver (get @pending-requests id)]
                             (p/resolve! resolver result)
                             (swap! pending-requests dissoc id)))
                         (catch :default e
                           (log! (str "JSON Parse Error: " e)))))))
                 (reset! input-buffer (last parts)))))))

    (.on socket "error" #(log! (str "Socket Error: " %)))

    (reset! client-socket socket)
    (log! "Connected via TCP!")))

(defn start-guile-server! [ext-path]
  (when-let [old-proc @server-proc]
    (.kill old-proc "SIGKILL"))

  (p/let [port (get-free-port!)]
    (log! (str "OS assigned free port: " port))

    (let [script-path (path/join ext-path "guile/server.scm")
          proc (cp/spawn "guile" (clj->js [script-path "--port" (str port)]))]

      (.on (.-stdout proc) "data"
           (fn [data]
             (let [msg (.toString data)]
               (log! (str "SERVER OUT: " msg))
               (when (clojure.string/includes? msg "Ready")
                 (connect-to-server! port)))))

      (.on (.-stderr proc) "data"
           (fn [data]
             (log! (str "SERVER LOG: " (.toString data)))))

      (.on proc "exit"
           (fn [code signal]
             (log! (str "Guile exited. Code: " code))
             (reset! server-proc nil)
             (reset! client-socket nil)))

      (reset! server-proc proc))))

(def token-types
  ["comment" "string" "keyword" "number" "function" "variable" "operator" "class" "macro"])

(def token-modifiers
  ["declaration" "documentation" "static"])

(def semantic-legend
  (new vscode/SemanticTokensLegend
       (clj->js token-types)
       (clj->js token-modifiers)))

(def guix-keywords
  #{"package" "origin" "git-reference" "build-system"
    "operating-system" "host-name" "timezone" "locale"
    "bootloader" "file-systems" "users" "packages" "services"
    "service" "home-environment" "home-bash-extension"})

(defn get-token-type [node-type text]
  (case node-type
    "line_comment" 0
    "string" 1
    "number" 3
    "boolean" 3
    "character" 1
    "symbol" (cond
               (contains? guix-keywords text) 7
               (clojure.string/starts-with? text "#~") 8
               (clojure.string/starts-with? text "#$") 8
               :else nil)
    nil))

(defn collect-tokens [builder node]
  (let [node-type (.-type node)
        node-text (.-text node)
        start-pos (.-startPosition node)
        line (.-row start-pos)
        char (.-column start-pos)
        length (- (.-endIndex node) (.-startIndex node))]

    (when-let [type-idx (get-token-type node-type node-text)]
      (.push builder line char length type-idx 0))

    (cond
      (and (= node-type "symbol")
           (= (.. node -parent -type) "list")
           (= (.. node -parent -firstChild -text) "define")
           (not= node-text "define"))
      (.push builder line char length 4 1)

      (and (= node-type "symbol")
           (#{"define" "define-public" "lambda" "if" "cond" "let" "let*" "begin" "use-modules" "use-package-modules"} node-text))
      (.push builder line char length 2 0)

      (and (= node-type "symbol")
           (nil? (get-token-type node-type node-text)))
      (.push builder line char length 5 0))

    (let [child-count (.-childCount node)]
      (dotimes [i child-count]
        (collect-tokens builder (.child node i))))))

(defn register-semantic-highlighting [context]
  (let [provider (clj->js {:provideDocumentSemanticTokens
                           (fn [document token]
                             (let [builder (new vscode/SemanticTokensBuilder semantic-legend)]
                               (when-let [parser @parser-ref]
                                 (let [tree (.parse parser (.getText document))]
                                   (collect-tokens builder (.-rootNode tree))
                                   (.build builder)))))})]

    (.push (.-subscriptions context)
           (.registerDocumentSemanticTokensProvider
            (.-languages vscode)
            (clj->js {:language "scheme"})
            provider
            semantic-legend))))

(defn format-document [document]
  (let [full-text (.getText document)
        full-range (new vscode/Range 0 0 (.-lineCount document) 0)]

    (p/let [formatted-text (send-request! "beguile/format" {:code full-text})]
      (if (and formatted-text (not= formatted-text full-text))
        (clj->js [(vscode/TextEdit.replace full-range formatted-text)])
        (clj->js [])))))

(defn register-formatter [context]
  (let [provider (clj->js {:provideDocumentFormattingEdits
                           (fn [document options token]
                             (format-document document))})]

    (.push (.-subscriptions context)
           (.registerDocumentFormattingEditProvider
            (.-languages vscode)
            "scheme"
            provider))))

(defn move-editor-selection [editor new-pos select?]
  (let [anchor (if select? (.-anchor (.-selection editor)) new-pos)
        new-selection (new vscode/Selection anchor new-pos)]
    (set! (.-selection editor) new-selection)
    (.revealRange editor new-selection)))

(defn find-forward-target [root offset]
  (let [node (.descendantForIndex root offset)]
    (when node
      (let [type (.-type node)
            start (.-startIndex node)
            end (.-endIndex node)
            parent (.-parent node)]

        (cond
          (and (#{"(" "[" "#~" "#$"} type) parent)
          (.-endIndex parent)

          (and (= type "list") (not= offset start))
          (let [children (array-seq (.-children node))
                next-child (some #(when (> (.-startIndex %) offset) %) children)]
            (if next-child
              (.-endIndex next-child)
              end))

          (< offset end)
          end

          :else
          (let [working-node (if (= offset end) node node)]
            (loop [curr working-node]
              (if-let [sibling (.-nextSibling curr)]
                (.-endIndex sibling)
                (if-let [p (.-parent curr)]
                  (if (= (.-type p) "program") nil (.-endIndex p))
                  nil)))))))))

(defn find-backward-target [root offset]
  (let [lookup-index (max 0 (dec offset))
        node (.descendantForIndex root lookup-index)]

    (when node
      (let [type (.-type node)
            start (.-startIndex node)
            parent (.-parent node)]

        (cond
          (and (#{")" "]"} type) parent)
          (.-startIndex parent)

          (and (= type "list") (> offset start))
          (let [children (reverse (array-seq (.-children node)))
                prev-child (some #(when (<= (.-endIndex %) offset) %) children)]
            (if prev-child
              (.-startIndex prev-child)
              start))

          (> offset start)
          start

          :else
          (let [working-node (if (= offset start) node node)]
            (loop [curr working-node]
              (if-let [sibling (.-previousSibling curr)]
                (.-startIndex sibling)
                (if-let [p (.-parent curr)]
                  (cond
                    (= (.-type p) "program") nil
                    (= (.-startIndex p) offset) (recur p)
                    :else (.-startIndex p))
                  nil)))))))))

(defn navigate-sexp [direction select?]
  (let [editor (.-activeTextEditor (.-window vscode))]
    (when (and editor @parser-ref)
      (let [doc (.-document editor)
            text (.getText doc)
            tree (.parse @parser-ref text)
            root (when tree (.-rootNode tree))
            offset (.offsetAt doc (.-active (.-selection editor)))]

        (when root
          (let [target-offset (if (= direction :forward)
                                (find-forward-target root offset)
                                (find-backward-target root offset))]

            (when (and target-offset (not= target-offset offset))
              (let [new-pos (.positionAt doc target-offset)]
                (move-editor-selection editor new-pos select?)))))))))

(def scope-decoration-type
  (vscode/window.createTextEditorDecorationType
   (clj->js {:color "#FFD700"
             :fontWeight "bold"
             :border "1px solid #FFD700"
             :borderRadius "2px"
             :rangeBehavior 1})))

(defn update-scope-highlight [editor]
  (when (and editor @parser-ref)
    (let [doc (.-document editor)
          offset (.offsetAt doc (.-active (.-selection editor)))
          root (.-rootNode (.parse @parser-ref (.getText doc)))]

      (letfn [(decorate-node [node]
                (let [start-pos (.-startPosition node)
                      end-pos (.-endPosition node)

                      range1 (new vscode/Range
                                  (.-row start-pos) (.-column start-pos)
                                  (.-row start-pos) (+ 1 (.-column start-pos)))

                      range2 (new vscode/Range
                                  (.-row end-pos) (- (.-column end-pos) 1)
                                  (.-row end-pos) (.-column end-pos))]

                  (.setDecorations editor scope-decoration-type (clj->js [range1 range2]))))]

        (let [node-right (.descendantForIndex root offset)
              node-left (if (> offset 0)
                          (.descendantForIndex root (dec offset))
                          nil)

              resolve-list (fn [n]
                             (when n
                               (cond
                                 (= (.-type n) "list") n
                                 (and (#{"(" ")"} (.-type n)) (.-parent n)) (.-parent n)
                                 :else nil)))]

          (cond
            (and node-right
                 (let [target (resolve-list node-right)]
                   (and target (= (.-startIndex target) offset))))
            (decorate-node (resolve-list node-right))

            (and node-left
                 (let [target (resolve-list node-left)]
                   (and target (= (.-endIndex target) offset))))
            (decorate-node (resolve-list node-left))

            :else
            (loop [node node-right]
              (if-not node
                (.setDecorations editor scope-decoration-type (clj->js []))

                (let [type (.-type node)
                      start (.-startIndex node)
                      end (.-endIndex node)]

                  (if (and (= type "list")
                           (< start offset)
                           (> end offset))
                    (decorate-node node)
                    (recur (.-parent node))))))))))))

(defn register-commands [context]
  (let [subs (.-subscriptions context)]
    (.push subs (vscode/commands.registerCommand "beguile.forwardSexp" #(navigate-sexp :forward false)))
    (.push subs (vscode/commands.registerCommand "beguile.backwardSexp" #(navigate-sexp :backward false)))
    (.push subs (vscode/commands.registerCommand "beguile.selectForwardSexp" #(navigate-sexp :forward true)))
    (.push subs (vscode/commands.registerCommand "beguile.selectBackwardSexp" #(navigate-sexp :backward true)))))

(defn register-providers [context]
  (let [hover-provider
        (clj->js {:provideHover
                  (fn [document position token]
                    (p/let [range (.getWordRangeAtPosition document position)
                            word (.getText document range)
                            full-text (.getText document)
                            result (send-request! "beguile/hover"
                                                  {:symbol word
                                                   :code full-text
                                                   :context []})]
                      (when result
                        (new vscode/Hover (new vscode/MarkdownString result)))))})]

    (let [sub (.registerHoverProvider (.-languages vscode) "scheme" hover-provider)]
      (.push (.-subscriptions context) sub))))

(defn activate [context]
  (.show output-channel true)
  (log! "=== Beguile Activation Started ===")

  (init-parser! context)
  (start-guile-server! (.-extensionPath context))

  (register-providers context)
  (register-semantic-highlighting context)
  (register-formatter context)
  (register-commands context)

  (.push (.-subscriptions context)
         (vscode/window.onDidChangeTextEditorSelection
          (fn [e] (update-scope-highlight (.-textEditor e)))))

  (js/undefined))

(defn deactivate []
  (when-let [sock @client-socket]
    (.end sock)
    (.destroy sock))

  (when-let [proc @server-proc]
    (.kill proc "SIGKILL"))

  (js/undefined))