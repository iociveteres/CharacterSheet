(function () {
    const AUTO_ADVANCE_DELAY = 4000; // 4 seconds default
    const MANUAL_DELAY = 15000; // 15 seconds after manual interaction
    let currentSlide = 0;
    let autoAdvanceTimer = null;
    let isManualMode = false;
    const slides = Array.from(document.querySelectorAll('.slide'));
    const dots = Array.from(document.querySelectorAll('.slide-dot'));
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = lightbox.querySelector('.lightbox-image');

    // Create video element for lightbox
    const lightboxVideo = document.createElement('video');
    lightboxVideo.className = 'lightbox-image';
    lightboxVideo.controls = true;
    lightboxVideo.autoplay = true;
    lightboxVideo.loop = true;     
    lightboxVideo.playsInline = true; 
    lightboxVideo.style.display = 'none';
    lightbox.insertBefore(lightboxVideo, lightbox.querySelector('.lightbox-close'));

    // Set correct theme images and videos on load
    function initThemeImages() {
        const theme = document.documentElement.getAttribute('data-theme') || 'light';

        // Handle images
        document.querySelectorAll('.theme-img').forEach(img => {
            img.src = theme === 'dark' ? img.dataset.dark : img.dataset.light;
        });

        // Handle videos
        document.querySelectorAll('.theme-video').forEach(video => {
            const sources = video.querySelectorAll('source');
            sources.forEach(source => {
                const newSrc = theme === 'dark' ? source.dataset.dark : source.dataset.light;
                if (newSrc && source.src !== newSrc) {
                    source.src = newSrc;
                }
            });
            // Reload video with new sources
            video.load();
        });
    }

    // Get media element (img or video) from slide
    function getMediaElement(slide) {
        return slide.querySelector('img, video');
    }

    // Get slide duration (custom or default)
    function getSlideDuration(slide) {
        const customDuration = slide.dataset.duration;
        return customDuration ? parseInt(customDuration, 10) : AUTO_ADVANCE_DELAY;
    }

    // Show specific slide
    function goToSlide(index, isManual = false) {
        slides[currentSlide].classList.remove('active');
        dots[currentSlide].classList.remove('active');

        // Pause any video in the previous slide
        const prevMedia = getMediaElement(slides[currentSlide]);
        if (prevMedia && prevMedia.tagName === 'VIDEO') {
            prevMedia.pause();
        }

        currentSlide = index;
        slides[currentSlide].classList.add('active');
        dots[currentSlide].classList.add('active');

        // Play video in the current slide
        const currentMedia = getMediaElement(slides[currentSlide]);
        if (currentMedia && currentMedia.tagName === 'VIDEO') {
            currentMedia.currentTime = 0;
            currentMedia.play().catch(() => {
                // Auto-play might be blocked, that's ok
            });
        }

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
        // Use the longer of MANUAL_DELAY or the current slide's duration
        const slideDuration = getSlideDuration(slides[currentSlide]);
        const delay = Math.max(MANUAL_DELAY, slideDuration);
        // Resume auto-advance after delay
        autoAdvanceTimer = setTimeout(() => {
            isManualMode = false;
            startAutoAdvance();
        }, delay);
    }

    // Start auto-advance
    function startAutoAdvance() {
        clearTimeout(autoAdvanceTimer);
        if (!isManualMode) {
            const duration = getSlideDuration(slides[currentSlide]);
            autoAdvanceTimer = setTimeout(() => {
                nextSlide(false);
            }, duration);
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
        const media = getMediaElement(slide);
        if (media) {
            media.addEventListener('click', () => {
                if (media.tagName === 'IMG') {
                    lightboxImg.src = media.src;
                    lightboxImg.style.display = 'block';
                    lightboxVideo.style.display = 'none';
                    lightbox.classList.add('active');
                    document.body.style.overflow = 'hidden';
                } else if (media.tagName === 'VIDEO') {
                    // Copy all sources from the clicked video
                    lightboxVideo.innerHTML = '';
                    const sources = media.querySelectorAll('source');
                    sources.forEach(source => {
                        const newSource = document.createElement('source');
                        newSource.src = source.src;
                        newSource.type = source.type;
                        lightboxVideo.appendChild(newSource);
                    });
                    lightboxVideo.load();
                    // Copy timestamp from slideshow video to lightbox video
                    lightboxVideo.currentTime = media.currentTime;
                    lightboxImg.style.display = 'none';
                    lightboxVideo.style.display = 'block';
                    lightbox.classList.add('active');
                    document.body.style.overflow = 'hidden';
                    // Pause slideshow and the slide video
                    clearTimeout(autoAdvanceTimer);
                    media.pause();
                }
            });
        }
    });

    function closeLightbox() {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
        // If video was in lightbox, sync timestamp back to slide video
        if (lightboxVideo.style.display === 'block') {
            const currentMedia = getMediaElement(slides[currentSlide]);
            if (currentMedia && currentMedia.tagName === 'VIDEO') {
                currentMedia.currentTime = lightboxVideo.currentTime;
                currentMedia.play().catch(() => { });
            }
            lightboxVideo.pause();
            lightboxVideo.currentTime = 0;
        }
        // Resume slideshow auto-advance
        if (!isManualMode) {
            startAutoAdvance();
        } else {
            handleManualInteraction();
        }
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
            // Pause any playing video
            const currentMedia = getMediaElement(slides[currentSlide]);
            if (currentMedia && currentMedia.tagName === 'VIDEO') {
                currentMedia.pause();
            }
        } else if (!isManualMode) {
            // Resume video if applicable
            const currentMedia = getMediaElement(slides[currentSlide]);
            if (currentMedia && currentMedia.tagName === 'VIDEO') {
                currentMedia.play().catch(() => { });
            }
            startAutoAdvance();
        }
    });
})();
