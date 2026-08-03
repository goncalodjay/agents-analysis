(require '[clojure.java.io :as io]
         '[babashka.process :as process])

(let [features (->> (file-seq (io/file "features"))
                     (filter #(and (.isFile %) (.endsWith (.getName %) ".feature")))
                     sort)]
  (doseq [feature features]
    (let [stem (-> (.getName feature) (clojure.string/replace #"[^A-Za-z0-9]+" "-") clojure.string/lower-case)
          ir (str "build/acceptance/ir/" stem ".json")
          generated (str "build/acceptance/generated/" stem)]
      (.mkdirs (io/file "build/acceptance/ir"))
      (process/shell {:out :inherit :err :inherit}
                     "bb" "gherkin-parser" (.getPath feature) ir)
      (process/shell {:out :inherit :err :inherit}
                     "bb" "-cp" "src" "scripts/acceptance_entrypoint.bb" ir generated)
      (process/shell {:out :inherit :err :inherit}
                     "bb" "-cp" "src" (str generated "/acceptance_test.bb")))))
