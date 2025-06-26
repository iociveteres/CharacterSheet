package main

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/internal/models"
	"github.com/julienschmidt/httprouter"
)

func (app *application) home(w http.ResponseWriter, r *http.Request) {
	sheets, err := app.sheets.Latest()
	if err != nil {
		app.serverError(w, err)
		return
	}

	data := app.newTemplateData(r)
	data.Sheets = sheets

	app.render(w, http.StatusOK, "home.html", data)
}

func (app *application) sheetView(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())

	id, err := strconv.Atoi(params.ByName("id"))
	if err != nil || id < 1 {
		app.notFound(w)
		return
	}

	sheet, err := app.sheets.Get(id)
	if err != nil {
		if errors.Is(err, models.ErrNoRecord) {
			app.notFound(w)
		} else {
			app.serverError(w, err)
		}
		return
	}

	data := app.newTemplateData(r)
	data.Sheet = sheet

	app.render(w, http.StatusOK, "view.html", data)
}

func (app *application) sheetCreate(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("Display the form for creating a new sheet..."))
}

func (app *application) sheetCreatePost(w http.ResponseWriter, r *http.Request) {
	title := "O snail"
	content := "O snail\nClimb Mount Fuji,\nBut slowly, slowly!\n\n– Kobayashi Issa"
	expires := 7

	id, err := app.sheets.Insert(title, content, expires)
	if err != nil {
		app.serverError(w, err)
		return
	}

	http.Redirect(w, r, fmt.Sprintf("/snippet/view/%d", id), http.StatusSeeOther)
}
