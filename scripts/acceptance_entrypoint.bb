#!/usr/bin/env bb
(require '[cheshire.core :as json]
         '[clojure.java.io :as io])

(let [[ir output] *command-line-args*]
  (when (or (nil? ir) (nil? output) (not= 2 (count *command-line-args*)))
    (binding [*out* *err*] (println "usage: acceptance-entrypoint-generator <json-ir> <generated-test-output>"))
    (System/exit 2))
  (let [feature (json/parse-string (slurp ir) true)
        out (io/file output)
        generated (io/file out "acceptance_test.bb")]
    (.mkdirs out)
    (spit generated (str "#!/usr/bin/env bb\n"
                         "(require '[trace-history.acceptance :as runtime])\n"
                         "(runtime/run-file " (pr-str (.getPath (io/file ir))) ")\n"))
    (.setExecutable generated true)
    (let [metadata-dir (io/file out "metadata")
          metadata-name (-> ir
                            (clojure.string/replace #"[^A-Za-z0-9]+" "-")
                            clojure.string/lower-case
                            (str ".json"))]
      (.mkdirs metadata-dir)
      (spit (io/file metadata-dir metadata-name)
            (json/generate-string {:schema_version 1
                                   :feature_path ir
                                   :ir_path ir
                                   :implementation_hash "sha256:generated"
                                   :hash_scope "generated_files"
                                   :generated_files [(.getPath generated)]}
                                  {:pretty true})))))
