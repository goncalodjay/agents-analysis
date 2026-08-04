// Package capture receives completed-agent events and stores them in local history.
package capture

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"sync"
)

// Serve accepts newline-delimited JSON events until the listener closes or context is cancelled.
func Serve(ctx context.Context, listener net.Listener, store ConsultationStore) error {
	var handlers sync.WaitGroup
	defer handlers.Wait()
	stopCancellation := context.AfterFunc(ctx, func() { _ = listener.Close() })
	defer stopCancellation()

	for {
		connection, err := listener.Accept()
		if err != nil {
			if listenerWasClosed(ctx, err) {
				return nil
			}
			return err
		}
		handlers.Add(1)
		go func() {
			defer handlers.Done()
			handle(connection, store)
		}()
	}
}

func listenerWasClosed(ctx context.Context, err error) bool {
	return ctx.Err() != nil || errors.Is(err, net.ErrClosed) || strings.Contains(err.Error(), "use of closed network connection")
}

func handle(connection net.Conn, store ConsultationStore) {
	defer connection.Close()
	var event Event
	err := json.NewDecoder(bufio.NewReader(connection)).Decode(&event)
	if err == nil {
		err = event.Validate()
	}
	if err == nil {
		err = store.Save(event.Consultation())
	}
	reply := Reply{Accepted: err == nil}
	if err != nil {
		reply.Reason = err.Error()
	} else {
		reply.ID = event.ID
	}
	_ = json.NewEncoder(connection).Encode(reply)
}
