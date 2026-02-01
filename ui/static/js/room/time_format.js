export function humanDate(date) {
    if (!date || isNaN(new Date(date).getTime())) {
        return '';
    }

    const t = new Date(date);

    function formatWithTZ(timeZone) {
        const options = {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone
        };
        const parts = new Intl.DateTimeFormat(undefined, options).formatToParts(t);
        const get = type => parts.find(p => p.type === type)?.value ?? '';
        return `${get('day')} ${get('month')} ${get('year')} at ${get('hour')}:${get('minute')}`;
    }

    try {
        return formatWithTZ(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
        return formatWithTZ('UTC');
    }
}

export function formatDateLabel(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateStr = date.toDateString();
    const todayStr = today.toDateString();
    const yesterdayStr = yesterday.toDateString();

    if (dateStr === todayStr) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';

    const options = { month: 'long', day: 'numeric' };
    return date.toLocaleDateString(undefined, options);
}

export function formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Flash message auto-hide
document.addEventListener('DOMContentLoaded', function () {
    const flashMessage = document.getElementById('flash-message');
    if (flashMessage) {
        setTimeout(function () {
            flashMessage.classList.add('hidden');
        }, 5000);
    }
});