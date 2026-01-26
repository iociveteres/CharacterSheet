export const diceMixin = {
    // State
    showDiceRoller: false,
    diceModifier: 0,
    diceAmount: 1,
    customDice: ['', '', '', '', ''],
    rollAgainstInputs: ['', '', '', ''],
    selectedRollAgainst: null,
    dicePresetDebounceTimers: {},

    // Methods
    setupDiceListeners() {
        document.addEventListener('ws:dicePresetUpdated', (e) => {
            const { slotNumber, diceNotation } = e.detail;
            if (slotNumber >= 1 && slotNumber <= 5) {
                this.customDice[slotNumber - 1] = diceNotation;
            }
        });

        document.addEventListener('room:rollVersus', (e) => {
            this.handleRollVersus(e.detail);
        });

        document.addEventListener('sheet:rollVersus', (e) => {
            this.handleRollVersus(e.detail);
        });

        document.addEventListener('room:rollExact', (e) => {
            this.handleRollExact(e.detail);
        });

        document.addEventListener('sheet:rollExact', (e) => {
            this.handleRollExact(e.detail);
        });
    },

    handleRollVersus(detail) {
        const { target, bonusSuccesses, label } = detail;

        // Construct command: /r d100 vs TARGET [+BONUS] (only show bonus if > 0)
        let command = `/r d100 vs ${target}`;
        if (bonusSuccesses > 0) {
            command += ` [+${bonusSuccesses}]`;
        }

        this.chatInput = command;
        this.$nextTick(() => {
            this.sendChatMessage();
        });
    },

    handleRollExact(detail) {
        const { expression, label } = detail;

        // Construct command: /r EXPRESSION
        const command = `/r ${expression}`;

        this.chatInput = command;
        this.$nextTick(() => {
            this.sendChatMessage();
        }); F
    },

    loadDiceSettings() {
        try {
            const key = `dice_amount_room_${this.$store.room.roomId}`;
            const stored = localStorage.getItem(key);
            if (stored) {
                const amount = parseInt(stored, 10);
                if (amount >= 1 && amount <= 5) {
                    this.diceAmount = amount;
                }
            }
        } catch (err) {
            console.error('Failed to load dice amount:', err);
        }

        try {
            const modKey = `dice_modifier_room_${this.$store.room.roomId}`;
            const storedMod = localStorage.getItem(modKey);
            if (storedMod) {
                const modifier = parseInt(storedMod, 10);
                if (modifier >= -60 && modifier <= 60) {
                    this.diceModifier = modifier;
                }
            }
        } catch (err) {
            console.error('Failed to load dice modifier:', err);
        }

        try {
            for (let i = 0; i < 4; i++) {
                const key = `dice_roll_against_${i}_room_${this.$store.room.roomId}`;
                const stored = localStorage.getItem(key);
                if (stored) {
                    this.rollAgainstInputs[i] = stored;
                }
            }
        } catch (err) {
            console.error('Failed to load roll against inputs:', err);
        }

        try {
            const selKey = `dice_roll_against_selected_room_${this.$store.room.roomId}`;
            const storedSel = localStorage.getItem(selKey);
            if (storedSel !== null) {
                const index = parseInt(storedSel, 10);
                if (index >= 0 && index <= 3) {
                    this.selectedRollAgainst = index;
                }
            }
        } catch (err) {
            console.error('Failed to load roll against selection:', err);
        }

        const presetEls = document.querySelectorAll('.ssr-dice-preset');
        presetEls.forEach(el => {
            const slot = parseInt(el.dataset.slot, 10);
            const notation = el.dataset.notation;
            if (slot >= 1 && slot <= 5 && notation) {
                this.customDice[slot - 1] = notation;
            }
        });
    },

    updateDiceAmount(amount) {
        this.diceAmount = amount;

        try {
            const key = `dice_amount_room_${this.$store.room.roomId}`;
            localStorage.setItem(key, amount.toString());
        } catch (err) {
            console.error('Failed to save dice amount:', err);
        }
    },

    updateDiceModifier(modifier) {
        this.diceModifier = modifier;

        try {
            const key = `dice_modifier_room_${this.$store.room.roomId}`;
            localStorage.setItem(key, modifier.toString());
        } catch (err) {
            console.error('Failed to save dice modifier:', err);
        }
    },

    toggleRollAgainst(index) {
        if (this.selectedRollAgainst === index) {
            this.selectedRollAgainst = null;
        } else {
            this.selectedRollAgainst = index;
        }

        try {
            const key = `dice_roll_against_selected_room_${this.$store.room.roomId}`;
            if (this.selectedRollAgainst === null) {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, this.selectedRollAgainst.toString());
            }
        } catch (err) {
            console.error('Failed to save roll against selection:', err);
        }
    },

    updateRollAgainstInput(index, value) {
        this.rollAgainstInputs[index] = value;

        try {
            const key = `dice_roll_against_${index}_room_${this.$store.room.roomId}`;
            if (value.trim()) {
                localStorage.setItem(key, value.trim());
            } else {
                localStorage.removeItem(key);
            }
        } catch (err) {
            console.error('Failed to save roll against input:', err);
        }
    },

    getActiveRollAgainst() {
        if (this.selectedRollAgainst === null) {
            return null;
        }

        const value = this.rollAgainstInputs[this.selectedRollAgainst];
        if (!value || !value.trim()) {
            return null;
        }

        const parsed = parseInt(value.trim(), 10);
        if (isNaN(parsed) || parsed < 1) {
            return null;
        }

        return parsed;
    },

    toggleDiceRoller() {
        this.showDiceRoller = !this.showDiceRoller;
    },

    closeDiceRoller() {
        if (this.showDiceRoller) {
            this.showDiceRoller = false;
        }
    },

    rollStandardDice(sides) {
        let command = `/r ${this.diceAmount}d${sides}`;

        const vsValue = this.getActiveRollAgainst();
        if (vsValue !== null) {
            const adjustedTarget = vsValue + this.diceModifier;
            command += ` vs ${adjustedTarget}`;
        } else {
            if (this.diceModifier !== 0) {
                const sign = this.diceModifier > 0 ? '+' : '';
                command += `${sign}${this.diceModifier}`;
            }
        }

        this.chatInput = command;

        this.$nextTick(() => {
            this.$refs.chatTextarea?.focus();
            this.sendChatMessage();
        });
    },

    rollCustomDice(index) {
        const notation = this.customDice[index]?.trim();
        if (!notation) return;

        const command = notation.startsWith('/r') ? notation : `/r ${notation}`;
        this.chatInput = command;

        this.$nextTick(() => {
            this.$refs.chatTextarea?.focus();
            this.sendChatMessage();
        });
    },

    isCustomDiceEmpty(index) {
        return !this.customDice[index] || !this.customDice[index].trim();
    },

    updateCustomDice(index, value) {
        this.customDice[index] = value;

        if (this.dicePresetDebounceTimers[index]) {
            clearTimeout(this.dicePresetDebounceTimers[index]);
        }

        this.dicePresetDebounceTimers[index] = setTimeout(() => {
            this.sendDicePresetUpdate(index + 1, value);
            delete this.dicePresetDebounceTimers[index];
        }, 500);
    },

    sendDicePresetUpdate(slotNumber, notation) {
        const payload = {
            type: 'updateDicePreset',
            eventID: crypto.randomUUID(),
            slotNumber: slotNumber,
            diceNotation: notation.trim()
        };
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
    }
};