document.addEventListener('DOMContentLoaded', () => {
    const carousel = document.querySelector('.carousel-inner');
    const leftArrow = document.querySelector('.arrow-left');
    const rightArrow = document.querySelector('.arrow-right');

    leftArrow.addEventListener('click', () => {
        carousel.scrollBy({ left: -250, behavior: 'smooth' });
    });

    rightArrow.addEventListener('click', () => {
        carousel.scrollBy({ left: 250, behavior: 'smooth' });
    });
});