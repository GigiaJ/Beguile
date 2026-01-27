(ns beguile.formatter
  (:require [rewrite-clj.zip :as z]
            [rewrite-clj.node :as node]
            [rewrite-clj.parser :as p]
            [clojure.string :as str]))

(defn- protect-guile [s]
  (-> s
      (str/replace #"#:([a-zA-Z0-9_-]+)" "BEGUILEKW$1")
      (str/replace #"([a-zA-Z0-9_-]+):(?=[\s\)])" "BEGUILEPFX$1")
      (str/replace #"#\$" "BEGUILEGX_S")
      (str/replace #"#~" "BEGUILEGX_T")
      (str/replace #"#\+" "BEGUILEGX_P")
      (str/replace #"#!" "BEGUILESHB")))

(defn- restore-guile [s]
  (-> s
      (str/replace #"BEGUILEKW([a-zA-Z0-9_-]+)" "#:$1")
      (str/replace #"BEGUILEPFX([a-zA-Z0-9_-]+)" "$1:")
      (str/replace #"BEGUILEGX_S" "#$")
      (str/replace #"BEGUILEGX_T" "#~")
      (str/replace #"BEGUILEGX_P" "#+")
      (str/replace #"BEGUILESHB" "#!")))

(defn- after-line-break? [zloc]
  (let [L (z/left* zloc)]
    (or (nil? L)
        (= :newline (z/tag L))
        (= :comment (z/tag L)))))

(defn- calculate-indent [zloc]
  (let [depth (loop [curr zloc d 0]
                (if-let [up (z/up curr)]
                  (recur up (inc d))
                  d))]
    (max 0 (* (dec depth) 2))))

(defn- format-node [zloc]
  (let [curr-node (z/node zloc)
        tag       (node/tag curr-node)]
    (cond
      (= tag :newline)
      (z/replace zloc (node/newline-node "\n"))
      (= tag :whitespace)
      (let [at-start? (nil? (z/left* zloc))
            at-end?   (nil? (z/right* zloc))]
        (cond
          (after-line-break? zloc)
          (let [i-count (calculate-indent zloc)
                i-str   (apply str (repeat i-count " "))]
            (if (not= (node/string curr-node) i-str)
              (z/replace zloc (node/whitespace-node i-str))
              zloc))
          (or at-start? at-end?)
          (z/remove zloc)
          :else
          (if (not= (node/string curr-node) " ")
            (z/replace zloc (node/whitespace-node " "))
            zloc)))

      :else zloc)))

(defn- normalize-vertical-spacing [s]
  (-> s
      (str/replace #"\n{3,}" "\n\n")
      (str/replace #"\)\n+\(" ")\n\n(")
      (str/replace #"\n\s*\n(\s+[^ \n])" "\n$1")
      (str/replace #"^\s*\n+" "")
      (str/replace #"\n+\s*$" "\n")))


(defn ^:export format-string [code-str]
  (try
    (let [safe-code (protect-guile code-str)
          root-node (p/parse-string-all safe-code)
          zloc      (z/of-node* root-node {:track-position? true})]

      (loop [curr zloc]
        (if (or (nil? curr) (z/end? curr))
          (-> (z/root-string curr)
              restore-guile
              normalize-vertical-spacing)
          (recur (z/next* (format-node curr))))))

    (catch :default err
      (.error js/console "Beguile Formatter Crash Detail:" err)
      code-str)))
