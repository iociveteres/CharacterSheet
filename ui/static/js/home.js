(function () {
    const AUTO_ADVANCE_DELAY = 4000; // 4 seconds
    const MANUAL_DELAY = 15000; // 15 seconds after manual interaction

    let currentSlide = 0;
    let autoAdvanceTimer = null;
    let isManualMode = false;

    const slides = Array.from(document.querySelectorAll('.slide'));
    const dots = Array.from(document.querySelectorAll('.slide-dot'));
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = lightbox.querySelector('.lightbox-image');

    // Set correct theme images on load
    function initThemeImages() {
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        document.querySelectorAll('.theme-img').forEach(img => {
            img.src = theme === 'dark' ? img.dataset.dark : img.dataset.light;
        });
    }

    // Show specific slide
    function goToSlide(index, isManual = false) {
        slides[currentSlide].classList.remove('active');
        dots[currentSlide].classList.remove('active');

        currentSlide = index;

        slides[currentSlide].classList.add('active');
        dots[currentSlide].classList.add('active');

        if (isManual) {
            handleManualInteraction();
        } else {
            startAutoAdvance();
        }
    }

    // Next slide
    function nextSlide(isManual = false) {
        const next = (currentSlide + 1) % slides.length;
        goToSlide(next, isManual);
    }

    // Previous slide
    function prevSlide(isManual = false) {
        const prev = (currentSlide - 1 + slides.length) % slides.length;
        goToSlide(prev, isManual);
    }

    // Handle manual interaction
    function handleManualInteraction() {
        isManualMode = true;
        clearTimeout(autoAdvanceTimer);

        // Resume auto-advance after 15 seconds
        autoAdvanceTimer = setTimeout(() => {
            isManualMode = false;
            startAutoAdvance();
        }, MANUAL_DELAY);
    }

    // Start auto-advance
    function startAutoAdvance() {
        clearTimeout(autoAdvanceTimer);

        if (!isManualMode) {
            autoAdvanceTimer = setTimeout(() => {
                nextSlide(false);
            }, AUTO_ADVANCE_DELAY);
        }
    }

    // Navigation buttons
    document.querySelector('.slide-nav.prev').addEventListener('click', () => {
        prevSlide(true);
    });

    document.querySelector('.slide-nav.next').addEventListener('click', () => {
        nextSlide(true);
    });

    // Dot navigation
    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            goToSlide(index, true);
        });
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
            prevSlide(true);
        } else if (e.key === 'ArrowRight') {
            nextSlide(true);
        } else if (e.key === 'Escape' && lightbox.classList.contains('active')) {
            closeLightbox();
        }
    });

    // Lightbox functionality
    slides.forEach(slide => {
        const img = slide.querySelector('img');
        img.addEventListener('click', () => {
            lightboxImg.src = img.src;
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    });

    function closeLightbox() {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    }

    lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });

    // Initialize
    initThemeImages();
    startAutoAdvance();

    // Pause on visibility change
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearTimeout(autoAdvanceTimer);
        } else if (!isManualMode) {
            startAutoAdvance();
        }
    });
})();