(ns trace-history.property-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is]]
            [trace-history.core :as core]
            [trace-history.store :as store]))

(defn- record [id status]
  {:id (str "consultation-" id)
   :status status
   :usage {:input id :prompt (* 2 id) :thinking (* 3 id) :output (* 4 id)}})

(deftest saving-completed-records-is-idempotent
  (doseq [size (range 0 40)
          id (range 0 (inc size))]
    (let [records (mapv #(record % :completed) (range size))
          saved (core/save-completed records (record id :completed))]
      (is (= saved (core/save-completed saved (record id :completed)))))))

(deftest visibility-preserves-only-completed-records
  (doseq [statuses (map #(take 4 (cycle %))
                        [[:completed :running :interrupted :completed]
                         [:running :interrupted :running :interrupted]
                         [:completed :completed :completed :completed]])]
    (is (every? #(= :completed (:status %))
                (core/visible-consultations (map-indexed record statuses))))))

(deftest summary-conserves-token-counts
  (doseq [size (range 0 40)]
    (let [records (mapv #(record (inc %) :completed) (range size))
          expected (reduce + (map #(* 10 (inc %)) (range size)))]
      (is (= expected (:tokens (core/summarize records)))))))

(deftest sqlite-round-trips-bounded-consultation-collections
  (doseq [size (range 0 40)]
    (let [path (str "tmp/property-store-" (System/nanoTime) ".sqlite")
          state {:consultations (mapv #(record % :completed) (range size))
                 :rates {:input 0.1 :prompt 0.2 :thinking 0.3 :output 0.4}}]
      (try
        (store/save-store! path state)
        (is (= state (store/load-store path)))
        (finally
          (.delete (io/file path)))))))
