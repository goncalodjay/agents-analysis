(ns trace-history.store-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is]]
            [trace-history.store :as store]))

(defn- temporary-database []
  (let [file (io/file "tmp" (str "store-test-" (System/nanoTime) ".sqlite"))]
    (io/make-parents file)
    (.delete file)
    (.getPath file)))

(deftest saves-complete-consultation-data-in-sqlite
  (let [path (temporary-database)
        state {:consultations
               [{:id "pi-1" :status :completed
                 :provider "openai" :model "gpt-5"
                 :prompts {:system "be helpful" :user "summarize"}
                 :context "repository context" :response "summary"
                 :tool-results [{:tool "read" :result "contents"}]
                 :usage {:input 12 :prompt 4 :thinking 3 :output 8}
                 :duration-ms 210 :result :success}]
               :rates {:openai {:input 0.1}}}]
    (store/save-store! path state)
    (is (= "SQLite format 3\000"
           (with-open [input (java.io.FileInputStream. path)]
             (String. (.readNBytes input 16) "UTF-8"))))
    (is (= state (store/load-store path)))))

(deftest saves-each-consultation-once-by-id
  (let [path (temporary-database)
        state {:consultations [{:id "pi-1" :status :completed}] :rates {}}]
    (store/save-store! path state)
    (store/save-store! path state)
    (is (= state (store/load-store path)))))
