(ns semantic
  (:require ["vscode" :as vscode]
            [parser :refer [parser-ref]]
            [guile :refer [send-request!]]
            [promesa.core :as p]
            [clojure.string :as str]
            [log :refer [log!]]))


(def token-types
  ["variable"  
   "function"  
   "keyword"   
   "string"    
   "number"    
   "comment"   
   "operator"  
   "class"     
   "macro"])   

(def semantic-legend
  (new vscode/SemanticTokensLegend (clj->js token-types)))

(def capture-map
  {"variable"            0
   "function"            1
   "keyword"             2
   "string"              3
   "number"              4
   "comment"             5
   "operator"            6
   "constructor"         7
   "type"                7
   "function.macro"      8
   "macro"               8
   "constant.builtin"    4
   "punctuation.bracket" 2
   "function.builtin"    1
   "constant"            4})

(defn provide-tokens [doc]
  (when-let [p @parser-ref]
    (let [builder (new vscode/SemanticTokensBuilder semantic-legend)
          tree    (.parse p (.getText doc))
          query   (.-query p)
          captures-raw (array-seq (.captures query (.-rootNode tree)))
          grouped (group-by #(.. % -node -startIndex) captures-raw)]

      (doseq [idx (sort (keys grouped))]
        
        (let [matches (get grouped idx)
              valid-matches (filter #(contains? capture-map (.-name %)) matches)
              best (last (sort-by #(get capture-map (.-name %)) valid-matches))]

          (when (and best (not= (.. best -node -type) "list"))
            (let [name (.-name best)
                  type-idx (get capture-map name)
                  node (.-node best)
                  start (.-startPosition node)
                  len (- (.-endIndex node) (.-startIndex node))]
              (.push builder (.-row start) (.-column start) len type-idx 0)))))
      (.build builder))))



(defn get-full-context-stack [node]
  (loop [curr node
         stack []]
    (if (nil? curr)
      stack
      (let [parent (.-parent curr)]
        (if (and parent (= (.-type parent) "list"))
          (let [op-node (.-firstNamedChild parent)]
            (recur parent (conj stack (.-text op-node))))
          (recur parent stack))))))

;; TODO: This is *awful* but for now it'll be okay.
(defn hunt-for-definition [target-doc word context]
  (let [text (.getText target-doc)
        re (js/RegExp. (str "(?<=^|[\\s\\(\\)])" word "(?=[\\s\\(\\)]|$)") "g")
        match (.exec re text)]
    (if match
      (let [pos (.positionAt target-doc (.-index match))]
        {:line (.-line pos) :character (.-character pos)})
      {:line 0 :character 0})))

(defn provide-definition [doc pos token]
  (let [range (.getWordRangeAtPosition doc pos)
        word (.getText doc range)]
    (p/let [tree (.parse @parser-ref (.getText doc))
            node (.descendantForIndex (.-rootNode tree) (.offsetAt doc pos))
            context (get-full-context-stack node)
            result-raw (send-request! "beguile/definition"
                                      {:symbol word
                                       :code (.getText doc)
                                       :context (clj->js context)})
            result (js->clj result-raw)
            raw-path (str/trim (get result "file" ""))
            uri (.file (.-Uri vscode) raw-path)
            target-doc (.openTextDocument (.-workspace vscode) uri)
            coords (if (or (not (get result "line")) (= 0 (get result "line")))
                     (hunt-for-definition target-doc word context)
                     {:line (get result "line") :character (get result "column")})

            v-pos (new (.-Position vscode) (:line coords) (:character coords))
            v-range (new (.-Range vscode) v-pos v-pos)]
      (log! (str "Created Location for URI: " uri " at line: " (:line coords)))
      (new (.-Location vscode) uri v-range))))

(defn provide-completions [doc pos token context]
  (let [range (.getWordRangeAtPosition doc pos)
        prefix (if range (.getText doc range) "")]
    (p/let [response (send-request! "beguile/completion" {:prefix prefix})
            results (get (js->clj response) "result")]
      (if (vector? results)
        (clj->js (map #(new (.-CompletionItem vscode) %) results))
        #js []))))


(defn register-definition-provider [context]
  (.push (.-subscriptions context)
         (.registerDefinitionProvider
          (.-languages vscode)
          (clj->js {:language "scheme"})
          (clj->js {:provideDefinition provide-definition}))))

(defn register-semantic-highlighting [context]
  (.push (.-subscriptions context)
         (.registerDocumentSemanticTokensProvider
          (.-languages vscode)
          (clj->js {:language "scheme"})
          (clj->js {:provideDocumentSemanticTokens
                    (fn [doc _] (provide-tokens doc))})
          semantic-legend)))


(defn register-completion-provider [context]
  (.push (.-subscriptions context)
         (.registerCompletionItemProvider
          (.-languages vscode)
          "scheme"
          (clj->js {:provideCompletionItems provide-completions})
          "." ":" "$" "-"))) 

(defn register-hover [context]
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
                        (new vscode/Hover (new vscode/MarkdownString result)))))})
        sub (.registerHoverProvider (.-languages vscode) "scheme" hover-provider)]
(.push (.-subscriptions context) sub)))