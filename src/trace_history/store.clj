(ns trace-history.store
  (:require [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.edn :as edn]
            [clojure.java.io :as io]))

(def ^:private empty-store {:consultations [] :rates {}})

(def ^:private sqlite-adapter
  "import base64, json, sqlite3, sys
path, action = sys.argv[1:]
connection = sqlite3.connect(path)
connection.execute('CREATE TABLE IF NOT EXISTS consultations (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
connection.execute('CREATE TABLE IF NOT EXISTS history_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
if action == 'write':
    state = json.load(sys.stdin)
    with connection:
        connection.execute('DELETE FROM consultations')
        connection.executemany('INSERT INTO consultations (id, payload) VALUES (?, ?)', state['consultations'])
        connection.execute('INSERT OR REPLACE INTO history_metadata (key, value) VALUES (?, ?)', ('rates', state['rates']))
else:
    consultations = list(connection.execute('SELECT payload FROM consultations ORDER BY rowid'))
    rates = connection.execute(\"SELECT value FROM history_metadata WHERE key = 'rates'\").fetchone()
    print(json.dumps({'consultations': [row[0] for row in consultations], 'rates': rates[0] if rates else None}))
connection.close()")

(defn- encode [value]
  (.encodeToString (java.util.Base64/getEncoder) (.getBytes (pr-str value) "UTF-8")))

(defn- decode [value]
  (edn/read-string (String. (.decode (java.util.Base64/getDecoder) value) "UTF-8")))

(defn- sqlite-file? [path]
  (and (.exists (io/file path))
       (with-open [input (java.io.FileInputStream. path)]
         (= "SQLite format 3\000"
            (String. (.readNBytes input 16) "UTF-8")))))

(defn- legacy-store [path]
  (when (and (.exists (io/file path)) (not (sqlite-file? path)))
    (edn/read-string (slurp path))))

(defn- invoke-sqlite! [path action input]
  (process/shell {:in input :out :string :err :string}
                 "python3" "-c" sqlite-adapter path action))

(defn load-store [path]
  (cond
    (not (.exists (io/file path))) empty-store
    (not (sqlite-file? path)) (or (legacy-store path) empty-store)
    :else (let [result (json/parse-string (:out (invoke-sqlite! path "read" "")) true)]
            {:consultations (mapv decode (:consultations result))
             :rates (if-let [rates (:rates result)] (decode rates) {})})))

(defn save-store! [path state]
  (io/make-parents path)
  (when (legacy-store path)
    (.delete (io/file path)))
  (let [payload (json/generate-string
                 {:consultations (mapv (fn [record] [(str (:id record)) (encode record)])
                                       (:consultations state))
                  :rates (encode (:rates state))})]
    (invoke-sqlite! path "write" payload))
  state)
