(ns trace-history.tui
  (:require [trace-history.core :as core]))

(defn start [records]
  (let [records (vec (sort-by :finished-at #(compare %2 %1)
                              (core/visible-consultations records)))]
    {:records records
     :selected-id (:id (first records))
     :panels #{:list :detail}
     :columns 80
     :rows 24
     :status (if (seq records) :ready :empty)}))

(defn move [model direction]
  (let [ids (mapv :id (:records model))
        index (.indexOf ids (:selected-id model))
        next-index (cond
                     (= direction :down) (min (dec (count ids)) (inc index))
                     (= direction :up) (max 0 (dec index))
                     :else index)]
    (assoc model :selected-id (get ids next-index))))

(defn filter-by [model filters]
  (let [matches? (fn [record]
                   (every? (fn [[key value]] (= value (get record key))) filters))
        records (vec (filter matches? (:records model)))]
    (assoc model :records records :selected-id (:id (first records)))))

(defn resize [model columns rows]
  (assoc model :columns columns :rows rows :panels #{:list :detail}))
