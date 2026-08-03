(ns trace-history.tui-test
  (:require [clojure.test :refer [deftest is]]
            [trace-history.tui :as tui]))

(def records [{:id "old" :status :completed :finished-at "2026-01-01T00:00:00Z" :provider "openai" :model "gpt-4"}
              {:id "new" :status :completed :finished-at "2026-02-01T00:00:00Z" :provider "anthropic" :model "claude"}])

(deftest model-orders-newest-first
  (is (= ["new" "old"] (mapv :id (:records (tui/start records))))))

(deftest navigation-wraps-and-filters
  (let [model (tui/start records)]
    (is (= "old" (:selected-id (tui/move model :down))))
    (is (= ["old"] (mapv :id (:records (tui/filter-by model {:provider "openai"})))))))

(deftest resize-keeps-both-panels
  (is (= {:columns 80 :rows 24 :panels #{:list :detail}}
         (select-keys (tui/resize (tui/start records) 80 24)
                      [:columns :rows :panels]))))
