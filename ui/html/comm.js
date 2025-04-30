export function makeDeletable(gridEl) {
    let deletionMode = false;
    gridEl
      .querySelector(".toggle-delete-mode")
      .addEventListener("click", () => {
        deletionMode = !deletionMode;
        gridEl.classList.toggle("deletion-mode", deletionMode);
      });
  }
  

export function createIdCounter(gridEl, itemSelector) {
    let lastId = 0; // Stores the last used ID for this specific grid

    // Initially scan the grid to find the highest ID
    gridEl.querySelectorAll(itemSelector).forEach((item) => {
        const [, num] = item.dataset.id.split("-");
        const n = parseInt(num, 10);
        if (!isNaN(n) && n > lastId) lastId = n;
    });

    // Return the closure that gives you the next ID
    return function() {
        lastId += 1;
        return lastId;
    };
}
