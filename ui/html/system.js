// how skill advancement affects test difficulty
export function calculateSkillAdvancement(count) {
    if (count == 0)
        return -20
    return (count - 1) * 10
}