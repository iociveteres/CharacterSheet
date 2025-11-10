package models

import (
	"encoding/json"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestValidateCharacterSheetJSON(t *testing.T) {
	// Set up a suite of table-driven tests and expected results.
	tests := []struct {
		name    string
		json    string
		wantErr bool
	}{
		{
			name: "Valid minimal JSON",
			json: `{
  "character-info": {
    "character-name": "New Character"
  },
  "characteristics": {},
  "skills-left": {},
  "skills-right": {},
  "custom-skills": {},
  "notes": {},
  "infamy-points": {},
  "fatigue": {},
  "initiative": 0,
  "size": 0,
  "movement": {},
  "armour": {},
  "ranged-attack": {},
  "melee-attack": {},
  "traits": {},
  "talents": {},
  "carry-weight-and-encumbrance": {},
  "gear": {},
  "cybernetics": {},
  "experience": {
    "experience-log": {}
  },
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {
    "psychic-powers": {}
  },
  "layouts": {
    "custom-skills": {},
    "notes": {},
    "ranged-attack": {},
    "melee-attack": {},
    "traits": {},
    "talents": {},
    "gear": {},
    "cybernetics": {},
    "experience-log": {},
    "mutations": {},
    "mental-disorders": {},
    "diseases": {},
    "psychic-powers": {}
  }
}`,
			wantErr: false,
		},
		{
			name: "Valid JSON with populated fields",
			json: `{
  "character-info": {
    "character-name": "Test Character",
    "archetype": "Warrior",
    "race": "Human"
  },
  "characteristics": {
    "strength": {
      "value": "45",
      "unnatural": "2"
    }
  },
  "skills-left": {},
  "skills-right": {},
  "custom-skills": {},
  "notes": {},
  "infamy-points": {
    "infamy_max": 10,
    "infamy_cur": 5,
    "infamy_temp": 2
  },
  "fatigue": {
    "fatigue_max": 8,
    "fatigue_cur": 3
  },
  "initiative": 5,
  "size": 4,
  "movement": {},
  "armour": {},
  "ranged-attack": {},
  "melee-attack": {},
  "traits": {},
  "talents": {},
  "carry-weight-and-encumbrance": {},
  "gear": {},
  "cybernetics": {},
  "experience": {
    "experience-log": {}
  },
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {
    "psychic-powers": {}
  },
  "layouts": {
    "custom-skills": {},
    "notes": {},
    "ranged-attack": {},
    "melee-attack": {},
    "traits": {},
    "talents": {},
    "gear": {},
    "cybernetics": {},
    "experience-log": {},
    "mutations": {},
    "mental-disorders": {},
    "diseases": {},
    "psychic-powers": {}
  }
}`,
			wantErr: false,
		},
		{
			name:    "Missing character-info",
			json:    `{}`,
			wantErr: true,
		},
		{
			name: "Missing character-name in character-info",
			json: `{
  "character-info": {},
  "characteristics": {},
  "skills-left": {},
  "skills-right": {},
  "custom-skills": {},
  "notes": {},
  "infamy-points": {},
  "fatigue": {},
  "initiative": 0,
  "size": 0,
  "movement": {},
  "armour": {},
  "ranged-attack": {},
  "melee-attack": {},
  "traits": {},
  "talents": {},
  "carry-weight-and-encumbrance": {},
  "gear": {},
  "cybernetics": {},
  "experience": {
    "experience-log": {}
  },
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {
    "psychic-powers": {}
  },
  "layouts": {
    "custom-skills": {},
    "notes": {},
    "ranged-attack": {},
    "melee-attack": {},
    "traits": {},
    "talents": {},
    "gear": {},
    "cybernetics": {},
    "experience-log": {},
    "mutations": {},
    "mental-disorders": {},
    "diseases": {},
    "psychic-powers": {}
  }
}`,
			wantErr: true,
		},
		{
			name: "Missing layouts field",
			json: `{
  "character-info": {
    "character-name": "New Character"
  },
  "characteristics": {},
  "skills-left": {},
  "skills-right": {},
  "custom-skills": {},
  "notes": {},
  "infamy-points": {},
  "fatigue": {},
  "initiative": 0,
  "size": 0,
  "movement": {},
  "armour": {},
  "ranged-attack": {},
  "melee-attack": {},
  "traits": {},
  "talents": {},
  "carry-weight-and-encumbrance": {},
  "gear": {},
  "cybernetics": {},
  "experience": {
    "experience-log": {}
  },
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {
    "psychic-powers": {}
  }
}`,
			wantErr: true,
		},
		{
			name: "Missing experience-log in experience",
			json: `{
  "character-info": {
    "character-name": "New Character"
  },
  "characteristics": {},
  "skills-left": {},
  "skills-right": {},
  "custom-skills": {},
  "notes": {},
  "infamy-points": {},
  "fatigue": {},
  "initiative": 0,
  "size": 0,
  "movement": {},
  "armour": {},
  "ranged-attack": {},
  "melee-attack": {},
  "traits": {},
  "talents": {},
  "carry-weight-and-encumbrance": {},
  "gear": {},
  "cybernetics": {},
  "experience": {},
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {
    "psychic-powers": {}
  },
  "layouts": {
    "custom-skills": {},
    "notes": {},
    "ranged-attack": {},
    "melee-attack": {},
    "traits": {},
    "talents": {},
    "gear": {},
    "cybernetics": {},
    "experience-log": {},
    "mutations": {},
    "mental-disorders": {},
    "diseases": {},
    "psychic-powers": {}
  }
}`,
			wantErr: true,
		},
		{
			name: "Missing psychic-powers in psykana",
			json: `{
  "character-info": {
    "character-name": "New Character"
  },
  "characteristics": {},
  "skills-left": {},
  "skills-right": {},
  "custom-skills": {},
  "notes": {},
  "infamy-points": {},
  "fatigue": {},
  "initiative": 0,
  "size": 0,
  "movement": {},
  "armour": {},
  "ranged-attack": {},
  "melee-attack": {},
  "traits": {},
  "talents": {},
  "carry-weight-and-encumbrance": {},
  "gear": {},
  "cybernetics": {},
  "experience": {
    "experience-log": {}
  },
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {},
  "layouts": {
    "custom-skills": {},
    "notes": {},
    "ranged-attack": {},
    "melee-attack": {},
    "traits": {},
    "talents": {},
    "gear": {},
    "cybernetics": {},
    "experience-log": {},
    "mutations": {},
    "mental-disorders": {},
    "diseases": {},
    "psychic-powers": {}
  }
}`,
			wantErr: true,
		},
		{
			name:    "Invalid JSON syntax",
			json:    `{"character-info": {`,
			wantErr: true,
		},
		{
			name: "Wrong type for initiative",
			json: `{
  "character-info": {
    "character-name": "New Character"
  },
  "characteristics": {},
  "skills-left": {},
  "skills-right": {},
  "custom-skills": {},
  "notes": {},
  "infamy-points": {},
  "fatigue": {},
  "initiative": "not a number",
  "size": 0,
  "movement": {},
  "armour": {},
  "ranged-attack": {},
  "melee-attack": {},
  "traits": {},
  "talents": {},
  "carry-weight-and-encumbrance": {},
  "gear": {},
  "cybernetics": {},
  "experience": {
    "experience-log": {}
  },
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {
    "psychic-powers": {}
  },
  "layouts": {
    "custom-skills": {},
    "notes": {},
    "ranged-attack": {},
    "melee-attack": {},
    "traits": {},
    "talents": {},
    "gear": {},
    "cybernetics": {},
    "experience-log": {},
    "mutations": {},
    "mental-disorders": {},
    "diseases": {},
    "psychic-powers": {}
  }
}`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw := json.RawMessage([]byte(tt.json))
			err := ValidateCharacterSheetJSON(raw)

			if tt.wantErr {
				assert.NotNilError(t, err)
			} else {
				assert.NilError(t, err)
			}
		})
	}
}
