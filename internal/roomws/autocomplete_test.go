package roomws

import (
	"encoding/json"
	"testing"
)

func TestOverlayObject(t *testing.T) {
	tests := []struct {
		name, base, top, want string
		wantErr               bool
	}{
		{
			name: "entry fields win, the rest comes from the base",
			base: `{"stacks":1,"enabled":true,"name":"old"}`,
			top:  `{"name":"Stunned","entries":{"items":{"e1":{"type":"char_bonus"}}}}`,
			want: `{"enabled":true,"entries":{"items":{"e1":{"type":"char_bonus"}}},"name":"Stunned","stacks":1}`,
		},
		{name: "null base", base: `null`, top: `{"name":"A"}`, want: `{"name":"A"}`},
		{name: "base is not an object", base: `[1]`, top: `{}`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := overlayObject(json.RawMessage(tt.base), json.RawMessage(tt.top))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("want an error, got %s", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tt.want {
				t.Errorf("got %s, want %s", got, tt.want)
			}
		})
	}
}
