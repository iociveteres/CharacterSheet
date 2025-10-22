package main

import (
	"reflect"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models"
)

func TestHumanDate(t *testing.T) {
	tests := []struct {
		name string
		tm   time.Time
		want string
	}{
		{
			name: "UTC",
			tm:   time.Date(2022, 3, 17, 10, 15, 0, 0, time.UTC),
			want: "17 Mar 2022 at 10:15",
		},
		{
			name: "Empty",
			tm:   time.Time{},
			want: "",
		},
		{
			name: "CET",
			tm:   time.Date(2022, 3, 17, 10, 15, 0, 0, time.FixedZone("CET", 1*60*60)),
			want: "17 Mar 2022 at 09:15",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hd := humanDate(tt.tm, nil)
			assert.Equal(t, hd, tt.want)
		})
	}
}

func TestColumnsFromLayout(t *testing.T) {
	tests := []struct {
		name      string
		container string
		positions map[string]models.Position
		data      map[string]any
		want      [][]string
	}{
		{
			name:      "empty data returns empty cols",
			container: "custom-skills",
			data:      map[string]any{},
			// function initializes cols and returns it when len(data) == 0,
			// for "custom-skills" defaultCols is 1 -> one empty column slice
			want: [][]string{{}},
		},
		{
			name:      "single column distribution",
			container: "custom-skills",
			data: map[string]any{
				"a": 1, "b": 1, "c": 1,
			},
			want: [][]string{{"a", "b", "c"}},
		},
		{
			name:      "multi column row-by-row distribution",
			container: "gear", // 3 columns
			data: map[string]any{
				"a": 1, "b": 1, "c": 1, "d": 1, "e": 1,
			},
			// fill row-by-row across 3 cols
			want: [][]string{
				{"a", "d"},
				{"b", "e"},
				{"c"},
			},
		},
		{
			name:      "layout positions respected",
			container: "traits", // 2 cols
			positions: map[string]models.Position{
				"x": {ColIndex: 0, RowIndex: 0},
				"y": {ColIndex: 1, RowIndex: 0},
			},
			data: map[string]any{
				"x": 1, "y": 1,
			},
			want: [][]string{
				{"x"},
				{"y"},
			},
		},
		{
			name:      "layout positions with missing keys",
			container: "traits", // 2 cols
			positions: map[string]models.Position{
				"x": {ColIndex: 0, RowIndex: 0},
			},
			data: map[string]any{
				"x": 1, "y": 1, "z": 1,
			},
			// "x" goes where placed, "y" and "z" sorted and distributed row-by-row
			want: [][]string{
				{"x", "z"},
				{"y"},
			},
		},
		{
			name:      "layout column index out of range is clamped",
			container: "talents", // 2 cols
			positions: map[string]models.Position{
				"x": {ColIndex: -1, RowIndex: 0}, // clamped to 0
				"y": {ColIndex: 10, RowIndex: 0}, // clamped to 1
			},
			data: map[string]any{
				"x": 1, "y": 1,
			},
			want: [][]string{
				{"x"},
				{"y"},
			},
		},
		{
			name:      "deterministic ordering of missing keys",
			container: "traits",
			data: map[string]any{
				"c": 1, "a": 1, "b": 1,
			},
			want: [][]string{
				{"a", "c"},
				{"b"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := columnsFromLayout(tt.container, tt.positions, tt.data)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %#v, want %#v", got, tt.want)
			}
		})
	}
}
