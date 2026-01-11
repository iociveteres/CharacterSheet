package ui

import (
	"crypto/md5"
	"embed"
	"encoding/hex"
	"encoding/json"
	"html/template"
	"io"
	"io/fs"
	"strings"
	"sync"
)

//go:embed "html" "static"
var Files embed.FS

var (
	fileHashes = make(map[string]string)
	hashOnce   sync.Once
)

func init() {
	hashOnce.Do(func() {
		fs.WalkDir(Files, "static", func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}

			file, err := Files.Open(path)
			if err != nil {
				return err
			}
			defer file.Close()

			hash := md5.New()
			if _, err := io.Copy(hash, file); err != nil {
				return err
			}

			fileHashes[path] = hex.EncodeToString(hash.Sum(nil))[:8]
			return nil
		})
	})
}

// VersionFunc returns a template function for cache busting
func VersionFunc() template.FuncMap {
	return template.FuncMap{
		"version": func(path string) string {
			fullPath := "static/" + path
			if hash, ok := fileHashes[fullPath]; ok {
				return hash
			}
			return "1"
		},
	}
}

func ImportMapJSON() string {
	entryPoints := map[string]bool{
		"static/js/sheet/script.js":  true,
	}

	imports := make(map[string]string)
	for path, hash := range fileHashes {
		if strings.HasPrefix(path, "static/js/sheet/") && strings.HasSuffix(path, ".js") {
			if entryPoints[path] {
				continue
			}
			key := "/" + path
			imports[key] = key + "?v=" + hash
		}
	}
	result := map[string]interface{}{"imports": imports}
	data, _ := json.Marshal(result)
	return string(data)
}
