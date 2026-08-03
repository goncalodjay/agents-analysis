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

(deftest render-describes-both-panels
  (let [screen (tui/render (tui/start records))]
    (is (string? screen))
    (is (re-find #"new" screen))
    (is (re-find #"detail" screen))))

(deftest input-loop-handles-navigation-detail-and-exit
  (let [model (tui/start records)]
    (is (= "old" (:selected-id (tui/handle-key model "down"))))
    (is (= :detail (:view (tui/handle-key model "enter"))))
    (is (= :list (:view (tui/handle-key (assoc model :view :detail) "esc"))))
    (is (= 0 (:exit-code (tui/handle-key model "q"))))))
