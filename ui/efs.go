package ui

import (
	"crypto/md5"
	"embed"
	"encoding/hex"
	"encoding/json"
	"html/template"
	"io"
	"io/fs"
	"os"
	"strings"
	"sync"
)

//go:embed "html" "static"
var Files embed.FS

var (
	fileHashes = make(map[string]string)
	hashOnce   sync.Once

	// devFS is set in dev mode: static files are served from disk so that
	// `npm run watch` output is picked up without rebuilding the binary.
	devFS fs.FS
)

func init() {
	hashOnce.Do(func() {
		fs.WalkDir(Files, "static", func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}

			hash, err := hashFile(Files, path)
			if err != nil {
				return err
			}
			fileHashes[path] = hash
			return nil
		})
	})
}

func hashFile(fsys fs.FS, path string) (string, error) {
	file, err := fsys.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := md5.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil))[:8], nil
}

// EnableDevMode serves static files from dir on disk instead of the embedded copy.
// Templates stay embedded.
func EnableDevMode(dir string) {
	devFS = os.DirFS(dir)
}

func DevMode() bool {
	return devFS != nil
}

// StaticFS holds the "static" directory: from disk in dev mode, embedded otherwise.
func StaticFS() fs.FS {
	if devFS != nil {
		return devFS
	}
	return Files
}

// VersionFunc returns a template function for cache busting
func VersionFunc() template.FuncMap {
	return template.FuncMap{
		"version": func(path string) string {
			fullPath := "static/" + path
			if devFS != nil {
				if hash, err := hashFile(devFS, fullPath); err == nil {
					return hash
				}
				return "1"
			}
			if hash, ok := fileHashes[fullPath]; ok {
				return hash
			}
			return "1"
		},
	}
}

// ImportMapJSON maps room modules to versioned URLs. The sheet is a single
// bundle (static/dist/sheet.js) and is versioned in the template instead.
func ImportMapJSON() string {
	entryPoints := map[string]bool{
		"static/js/room/component.js": true,
	}

	moduleDirs := []string{
		"static/js/room/",
	}

	imports := make(map[string]string)

	for path, hash := range fileHashes {
		if isModuleFile(path, moduleDirs) && !entryPoints[path] {
			key := "/" + path
			imports[key] = key + "?v=" + hash
		}
	}

	result := map[string]any{"imports": imports}
	data, _ := json.Marshal(result)
	return string(data)
}

func isModuleFile(path string, dirs []string) bool {
	if !strings.HasSuffix(path, ".js") {
		return false
	}
	for _, dir := range dirs {
		if strings.HasPrefix(path, dir) {
			return true
		}
	}
	return false
}
