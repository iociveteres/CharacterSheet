import { Dropdown } from "../elementsLayout.js";


export class ArmourPart {
    constructor(container) {
        this.container = container;

        // Get root for closing other dropdowns
        const root = container.getRootNode();

        // Initialize dropdown
        this.dropdown = new Dropdown({
            container: this.container,
            toggleSelector: '.armour-extra-toggle',
            dropdownSelector: '.armour-extra-dropdown',
            onOpen: () => {
                // Close all other armour dropdowns
                this._closeOtherArmourDropdowns(root);
                // Raise this body-part above siblings
                this.container.style.zIndex = '100';
            },
            onClose: () => {
                // Reset z-index when closing
                this.container.style.zIndex = '';
            },
            shouldCloseOnOutsideClick: (e) => {
                // Close if clicking outside any body-part
                return !e.target.closest('.body-part');
            }
        });

        // Store reference to dropdown instance on container
        this.container._dropdownInstance = this.dropdown;
    }

    _closeOtherArmourDropdowns(root) {
        // Find all body parts and close their dropdowns
        const allBodyParts = root.querySelectorAll('.body-part');
        allBodyParts.forEach(bp => {
            if (bp !== this.container && bp._dropdownInstance) {
                bp._dropdownInstance.close();
            }
        });
    }
}
