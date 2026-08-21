package templates

import (
	"reflect"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

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
			container: "custom-skills", // not in defaultCols -> falls back to 1 col
			data:      map[string]any{},
			want:      [][]string{{}},
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
			want: [][]string{
				{"a", "d"},
				{"b", "e"},
				{"c"},
			},
		},
		{
			name:      "layout positions respected",
			container: "traits", // 3 cols
			positions: map[string]models.Position{
				"x": {ColIndex: 0, RowIndex: 0},
				"y": {ColIndex: 1, RowIndex: 0},
			},
			data: map[string]any{
				"x": 1, "y": 1,
			},
			// col2 has no data placed in it and stays empty
			want: [][]string{
				{"x"},
				{"y"},
				{},
			},
		},
		{
			name:      "layout positions with missing keys",
			container: "traits", // 3 cols
			positions: map[string]models.Position{
				"x": {ColIndex: 0, RowIndex: 0},
			},
			data: map[string]any{
				"x": 1, "y": 1, "z": 1,
			},
			// "x" goes where placed; "y","z" sorted and distributed
			// row-by-row across the remaining 2 empty columns (col1, col2)
			want: [][]string{
				{"x"},
				{"y"},
				{"z"},
			},
		},
		{
			name:      "layout column index out of range is clamped",
			container: "talents", // 3 cols
			positions: map[string]models.Position{
				"x": {ColIndex: -1, RowIndex: 0}, // clamped to 0
				"y": {ColIndex: 10, RowIndex: 0}, // clamped to 2 (colsCount-1)
			},
			data: map[string]any{
				"x": 1, "y": 1,
			},
			want: [][]string{
				{"x"},
				{},
				{"y"},
			},
		},
		{
			name:      "deterministic ordering of missing keys",
			container: "traits", // 3 cols
			data: map[string]any{
				"c": 1, "a": 1, "b": 1,
			},
			// missing keys sorted [a,b,c], placed row-by-row across 3 cols
			want: [][]string{
				{"a"},
				{"b"},
				{"c"},
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
