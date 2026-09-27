// The dice roller over the right panel: its rolls go to the chat.
import { useEffect, useState } from "preact/hooks";
import { dicePresets, diceSettings } from "../state";
import {
    rollPreset, rollStandardDice, setDiceAmount, setDiceModifier, setDicePreset, setRollAgainst, toggleRollAgainst,
} from "../actions";
import { focusChatInput } from "./Chat";
import { Transition } from "./Transition";

const NEGATIVE_MODIFIERS = [-60, -50, -40, -30, -20, -10];
const POSITIVE_MODIFIERS = [10, 20, 30, 40, 50, 60];

export function DiceRoller() {
    const [open, setOpen] = useState(false);

    // Stays with the button for the page: a listener added with the popover
    // would miss an Esc pressed before its effect runs.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
        <>
            <button onClick={() => setOpen(o => !o)} class="dice-roller-btn" type="button" title="Dice roller">⚄</button>
            <Transition show={open} name="popover">
                <div class="dice-popover">
                    <div class="dice-popover-header">
                        <span>Dice Roller</span>
                        <button onClick={() => setOpen(false)} class="dice-close-btn" type="button" title="Close">×</button>
                    </div>
                    <DiceSettingsForm />
                </div>
            </Transition>
        </>
    );
}

function roll(send: () => void): void {
    focusChatInput();
    send();
}

function DiceSettingsForm() {
    const settings = diceSettings.value;
    const modifier = (n: number) => (
        <label key={n} class="dice-radio-label">
            <input type="radio" name="dice-modifier" value={n} checked={settings.modifier === n}
                onChange={() => setDiceModifier(n)} />
            <span>{n > 0 ? `+${n}` : n}</span>
        </label>
    );

    return (
        <>
            <div class="roll-against-section">
                <div class="roll-against-label">Roll against:</div>
                <div class="roll-against-grid">
                    {settings.rollAgainst.map((target, i) => (
                        <div key={i} class="roll-against-item">
                            <input type="number" value={target} onInput={e => setRollAgainst(i, e.currentTarget.value)}
                                class="roll-against-input" min="1" max="999" />
                            <label class="chk-label"> </label>
                            <input type="checkbox" class="custom" checked={settings.selected === i}
                                onChange={() => toggleRollAgainst(i)} />
                        </div>
                    ))}
                </div>
            </div>

            <div class="dice-modifier-section">
                <div class="dice-modifier-label">Modifier:</div>
                <div class="dice-modifier-grid">
                    <div class="dice-modifier-row">{NEGATIVE_MODIFIERS.map(modifier)}</div>
                    <div class="dice-modifier-row dice-modifier-zero-row">
                        <label class="dice-radio-label dice-zero-label">
                            <input type="radio" name="dice-modifier" value={0} checked={settings.modifier === 0}
                                onChange={() => setDiceModifier(0)} />
                            <span>0</span>
                        </label>
                    </div>
                    <div class="dice-modifier-row">{POSITIVE_MODIFIERS.map(modifier)}</div>
                </div>
            </div>

            <div class="dice-amount-section">
                <div class="dice-amount-label">Number of dice:</div>
                <div class="dice-amount-radio">
                    {[1, 2, 3, 4, 5].map(n => (
                        <label key={n} class="dice-radio-label">
                            <input type="radio" name="dice-amount" value={n} checked={settings.amount === n}
                                onChange={() => setDiceAmount(n)} />
                            <span>{n}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div class="standard-dice-section">
                {[5, 10, 20, 100].map(sides => (
                    <button key={sides} onClick={() => roll(() => rollStandardDice(sides))} class="dice-btn" type="button">
                        d{sides}
                    </button>
                ))}
            </div>

            <div class="custom-dice-section">
                <div class="custom-dice-label">Custom rolls:</div>
                {dicePresets.value.map((notation, i) => (
                    <div key={i} class="custom-dice-row">
                        <input type="text" value={notation} onInput={e => setDicePreset(i, e.currentTarget.value)}
                            onKeyDown={e => e.key === "Enter" && notation.trim() && roll(() => rollPreset(i))}
                            placeholder={i === 0 ? "e.g., 2d10+5" : undefined} class="custom-dice-input" />
                        <button onClick={() => roll(() => rollPreset(i))} class="custom-dice-roll-btn" type="button"
                            disabled={!notation.trim()}>
                            Roll
                        </button>
                    </div>
                ))}
            </div>
        </>
    );
}
