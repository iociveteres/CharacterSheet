package main

import "charactersheet.iociveteres.net/internal/models"

type templateData struct {
	Sheet  *models.Sheet
	Sheets []*models.Sheet
}
