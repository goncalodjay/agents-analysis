(ns trace-history.core-test
  (:require [clojure.test :refer [deftest is]]
            [trace-history.core :as core]))

(deftest completed-consultation-is-idempotent
  (let [record {:id "consulta-1" :status :completed :provider "openai"}]
    (is (= 1 (count (core/save-completed [] record))))
    (is (= 1 (count (core/save-completed
                     (core/save-completed [] record) record))))))

(deftest incomplete-consultations-are-not-visible
  (is (empty? (core/visible-consultations
               [{:id "x" :status :running}
                {:id "y" :status :interrupted}]))))

(deftest cost-uses-snapshot-of-rates
  (let [record {:id "x" :status :completed
                :usage {:input 100 :prompt 20 :thinking 10 :output 50}}
        rates {:input 0.000002 :prompt 0.000001
               :thinking 0.000003 :output 0.000004}
        saved (core/attach-cost record rates)]
    (is (< (abs (- 0.00046 (:cost saved))) 0.00002))
    (is (= rates (:rate-snapshot saved)))))

(deftest missing-rate-means-no-cost
  (is (nil? (:cost (core/attach-cost {:usage {:input 1}} nil)))))

(deftest summary-counts-tokens-and-known-costs
  (let [summary (core/summarize
                 [{:status :completed
                   :usage {:input 100 :prompt 20 :thinking 10 :output 50}
                   :cost 0.00046 :currency "USD"}
                  {:status :completed
                   :usage {:input 200 :prompt 40 :thinking 20 :output 100}
                   :cost 0.00092 :currency "USD"}])]
    (is (< (abs (- 520 (:tokens summary))) 25))
    (is (< (abs (- 0.00138 (:cost summary))) 0.00002))
    (is (= "USD" (:currency summary)))))
