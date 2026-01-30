(ns highlighter
  (:require ["vscode" :as vscode]
            [parser :refer [parser-ref]]))

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