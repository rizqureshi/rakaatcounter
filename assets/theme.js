/* ==========================================================================
   Rakaat Counter — Theme JS
   ========================================================================== */

(function () {
  'use strict';

  /* --------------------------------------------------------------------------
     Utility: Debounce Helper
     -------------------------------------------------------------------------- */

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /* --------------------------------------------------------------------------
     Accessibility: Live Region Announcements
     -------------------------------------------------------------------------- */

  const A11yAnnouncer = {
    announce(message, region = 'polite') {
      // Create or get live region
      let liveRegion = document.getElementById(`aria-live-${region}`);
      if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.id = `aria-live-${region}`;
        liveRegion.className = 'sr-only';
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        liveRegion.setAttribute('role', 'status');
        document.body.appendChild(liveRegion);
      }
      // Clear previous message (for screen readers to detect change)
      liveRegion.textContent = '';
      // Set new message
      setTimeout(() => {
        liveRegion.textContent = message;
      }, 100);
    },
  };

  /* --------------------------------------------------------------------------
     Cart Drawer
     -------------------------------------------------------------------------- */

  const CartDrawer = {
    drawer:    null,
    overlay:   null,
    openBtns:  null,
    closeBtns: null,
    isUpdating: false,
    updateQueue: null,

    init() {
      this.drawer   = document.getElementById('cart-drawer');
      this.overlay  = document.getElementById('overlay');
      this.openBtns = document.querySelectorAll('[aria-controls="cart-drawer"]');
      this.closeBtns = document.querySelectorAll('[data-close-cart]');

      if (!this.drawer) return;

      this.openBtns.forEach(btn => {
        btn.addEventListener('click', () => this.open());
      });

      this.closeBtns.forEach(btn => {
        btn.addEventListener('click', () => this.close());
      });

      document.querySelector('.cart-drawer__close')?.addEventListener('click', () => this.close());
      this.overlay?.addEventListener('click', () => this.close());

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.close();
      });

      this.drawer.addEventListener('click', (e) => {
        const decreaseBtn = e.target.closest('[data-action="decrease"]');
        const increaseBtn = e.target.closest('[data-action="increase"]');
        const removeBtn   = e.target.closest('[data-remove-item]');
        const closeBtn    = e.target.closest('[data-close-cart]');

        if (decreaseBtn) this.debouncedUpdateQty(decreaseBtn, -1);
        if (increaseBtn) this.debouncedUpdateQty(increaseBtn, +1);
        if (removeBtn)   this.debouncedRemoveItem(removeBtn.dataset.removeItem);
        if (closeBtn)    { e.preventDefault(); this.close(); }
      });

      // Create debounced versions of update functions (300ms debounce)
      this.debouncedUpdateQty = debounce((btn, delta) => {
        this.updateQty(btn, delta);
      }, 300);

      this.debouncedRemoveItem = debounce((key) => {
        this.removeItem(key);
      }, 300);
    },

    open() {
      this.drawer.classList.add('is-open');
      this.overlay?.classList.add('is-visible');
      this.drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      this.drawer.querySelector('.cart-drawer__close')?.focus();
    },

    close() {
      this.drawer.classList.remove('is-open');
      this.overlay?.classList.remove('is-visible');
      this.drawer.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    },

    async updateQty(btn, delta) {
      const item = btn.closest('.cart-item');
      const key  = item?.dataset.cartItem;
      const qtyEl = item?.querySelector('.cart-item__qty-value');
      if (!key || !qtyEl) return;

      const newQty = Math.max(0, parseInt(qtyEl.textContent) + delta);
      await this.updateCartItem(key, newQty);
    },

    async removeItem(key) {
      await this.updateCartItem(key, 0);
    },

    async updateCartItem(key, quantity) {
      // Prevent concurrent requests (race condition protection)
      if (this.isUpdating) {
        console.warn('Cart update already in progress, please wait...');
        return;
      }

      this.isUpdating = true;

      try {
        const res = await fetch('/cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: key, quantity }),
        });
        const cart = await res.json();
        this.refreshDrawer(cart);
        this.updateCartCount(cart.item_count);
        
        // Announce cart update to screen readers
        if (quantity === 0) {
          A11yAnnouncer.announce('Item removed from cart.');
        } else {
          A11yAnnouncer.announce(`Cart updated. ${cart.item_count} item${cart.item_count !== 1 ? 's' : ''} in cart.`);
        }
      } catch (err) {
        console.error('Cart update failed:', err);
        A11yAnnouncer.announce('Error updating cart. Please try again.');
      } finally {
        this.isUpdating = false;
      }
    },

    updateCartCount(count) {
      document.querySelectorAll('.header__cart-count').forEach(el => {
        el.textContent = count;
        el.style.display = count > 0 ? '' : 'none';
      });
    },

    async refreshDrawer(cart) {
      try {
        const res  = await fetch('/?section_id=cart-drawer');
        const html = await res.text();
        const doc  = new DOMParser().parseFromString(html, 'text/html');
        const body = doc.getElementById('cart-drawer');
        if (body && this.drawer) {
          this.drawer.innerHTML = body.innerHTML;
        }
      } catch (err) {
        console.error('Cart drawer refresh failed:', err);
      }
    },
  };

  /* --------------------------------------------------------------------------
     Add to Cart — Featured Product
     -------------------------------------------------------------------------- */

  function showAtcError(message, nearEl) {
    const existing = nearEl.parentElement.querySelector('.main-product__atc-error');
    if (existing) existing.remove();
    const el = document.createElement('p');
    el.className = 'main-product__atc-error';
    el.setAttribute('role', 'alert');
    el.textContent = message;
    nearEl.insertAdjacentElement('afterend', el);
    setTimeout(() => el.remove(), 6000);
  }

  const AddToCart = {
    isAddingToCart: false,

    init() {
      document.getElementById('featured-product-form')
        ?.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          // Prevent concurrent add-to-cart requests
          if (this.isAddingToCart) {
            console.warn('Add to cart already in progress...');
            return;
          }

          const form   = e.target;
          const btn    = form.querySelector('[type="submit"]');
          const formData = new FormData(form);

          this.isAddingToCart = true;
          btn.disabled   = true;
          btn.textContent = 'Adding...';

          try {
            const res = await fetch('/cart/add.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id:       formData.get('id'),
                quantity: parseInt(formData.get('quantity')) || 1,
              }),
            });

            if (res.ok) {
              const cartRes  = await fetch('/cart.js');
              const cart     = await cartRes.json();
              CartDrawer.updateCartCount(cart.item_count);
              await CartDrawer.refreshDrawer(cart);
              CartDrawer.open();
            } else {
              const data = await res.json().catch(() => ({}));
              showAtcError(data.description || 'Unable to add this item to cart. Please try again.', btn);
            }
          } catch (err) {
            showAtcError('Unable to add this item to cart. Please try again.', btn);
          } finally {
            this.isAddingToCart = false;
            btn.disabled    = false;
            btn.textContent = 'Add to Cart';
          }
        });

      // Quick-add from product cards with debounce
      let addToCartTimeout;
      document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.product-card__add-btn');
        if (!btn) return;

        // Prevent rapid clicks
        if (btn.disabled) return;

        const id = btn.dataset.productId;
        if (!id) return;

        btn.disabled    = true;
        btn.textContent = '...';

        // Debounce rapid button clicks (prevent multiple simultaneous requests)
        clearTimeout(addToCartTimeout);
        
        addToCartTimeout = setTimeout(async () => {
          try {
            const res = await fetch('/cart/add.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, quantity: 1 }),
            });
            if (res.ok) {
              const cartRes = await fetch('/cart.js');
              const cart    = await cartRes.json();
              CartDrawer.updateCartCount(cart.item_count);
              await CartDrawer.refreshDrawer(cart);
              CartDrawer.open();
            } else {
              showAtcError('Unable to add this item to cart. Please try again.', btn);
            }
          } catch (err) {
            showAtcError('Unable to add this item to cart. Please try again.', btn);
          } finally {
            btn.disabled    = false;
            btn.textContent = 'Add to Cart';
          }
        }, 300); // 300ms debounce to prevent rapid-fire requests
      });
    },
  };

  /* --------------------------------------------------------------------------
     Product Variant Selector
     -------------------------------------------------------------------------- */

  const VariantSelector = {
    init() {
      const form = document.getElementById('featured-product-form');
      if (!form) return;

      form.addEventListener('click', (e) => {
        const btn = e.target.closest('.product-option__value');
        if (!btn) return;

        const optionName = btn.dataset.optionName;
        const optionValue = btn.dataset.optionValue;

        // Update selected state
        form.querySelectorAll(`[data-option-name="${optionName}"]`).forEach(b => {
          b.classList.remove('selected');
        });
        btn.classList.add('selected');

        this.updateVariant(form);
      });
    },

    updateVariant(form) {
      const selected = {};
      const optionNames = [];
      form.querySelectorAll('.product-option__value.selected').forEach(btn => {
        selected[btn.dataset.optionName] = btn.dataset.optionValue;
        optionNames.push(btn.dataset.optionName);
      });

      // Shopify variant matching via JSON endpoint
      const variantId = form.querySelector('[name="id"]')?.value;
      if (variantId) {
        fetch(`/products/${window.location.pathname.split('/products/')[1]}.js`)
          .then(r => r.json())
          .then(product => {
            // Match variant by option names and values
            const match = product.variants.find(v => {
              return v.options.every((optValue, index) => {
                const optionName = product.options[index];
                return optValue === selected[optionName];
              });
            });
            
            if (match) {
              // Update hidden variant ID field
              const idField = form.querySelector('[name="id"]');
              if (idField) idField.value = match.id;
              
              // Update price display
              const priceEl = document.getElementById('featured-product-price');
              if (priceEl && match.price !== undefined) {
                const formatted = new Intl.NumberFormat(
                  document.documentElement.lang,
                  { style: 'currency', currency: window.Shopify?.currency?.active || 'USD' }
                ).format(match.price / 100);
                const priceSpan = priceEl.querySelector('.price');
                if (priceSpan) priceSpan.textContent = formatted;
              }
              
              // Update add to cart button state
              const addBtn = form.querySelector('[type="submit"]');
              if (addBtn) {
                addBtn.disabled = !match.available;
                addBtn.textContent = match.available ? 'Add to Cart' : 'Sold Out';
              }
            }
          })
          .catch(err => console.error('Variant fetch error:', err));
      }
    },
  };

  /* --------------------------------------------------------------------------
     Product Thumbnail Gallery
     -------------------------------------------------------------------------- */

  const Gallery = {
    init() {
      document.querySelectorAll('.featured-product__thumb').forEach(thumb => {
        thumb.addEventListener('click', () => {
          const imgUrl  = thumb.dataset.imageUrl;
          const mainImg = document.getElementById('featured-product-main-image');
          if (mainImg && imgUrl) {
            mainImg.src = imgUrl;
          }
          document.querySelectorAll('.featured-product__thumb').forEach(t => {
            t.classList.remove('active');
          });
          thumb.classList.add('active');
        });
      });
    },
  };

  /* --------------------------------------------------------------------------
     Mobile Navigation
     -------------------------------------------------------------------------- */

  const MobileNav = {
    init() {
      const toggle = document.querySelector('.header__menu-toggle');
      const nav    = document.getElementById('mobile-nav');
      if (!toggle || !nav) return;

      // Main menu toggle
      toggle.addEventListener('click', () => {
        const isOpen = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!isOpen));
        nav.setAttribute('aria-hidden', String(isOpen));
        nav.classList.toggle('is-open', !isOpen);
      });

      // Submenu toggle buttons
      document.querySelectorAll('[data-submenu-toggle]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const isExpanded = btn.getAttribute('aria-expanded') === 'true';
          btn.setAttribute('aria-expanded', String(!isExpanded));
          
          // Toggle submenu visibility
          const submenu = btn.closest('.mobile-nav__item')?.querySelector('.mobile-nav__sub');
          if (submenu) {
            submenu.setAttribute('aria-hidden', String(isExpanded));
            submenu.classList.toggle('is-open', !isExpanded);
          }
        });
      });
    },
  };

  /* --------------------------------------------------------------------------
     Sticky Header Shadow
     -------------------------------------------------------------------------- */

  const StickyHeader = {
    init() {
      const header = document.querySelector('.header--sticky');
      if (!header) return;

      const observer = new IntersectionObserver(
        ([entry]) => header.classList.toggle('header--scrolled', !entry.isIntersecting),
        { rootMargin: '-1px 0px 0px 0px', threshold: [1] }
      );

      const sentinel = document.createElement('div');
      sentinel.style.cssText = 'position:absolute;top:0;width:1px;height:1px;pointer-events:none';
      document.body.prepend(sentinel);
      observer.observe(sentinel);
    },
  };

  /* --------------------------------------------------------------------------
     Header Dropdown
     -------------------------------------------------------------------------- */

  const HeaderDropdown = {
    init() {
      document.querySelectorAll('.header__nav-link--dropdown-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const isExpanded = btn.getAttribute('aria-expanded') === 'true';
          btn.setAttribute('aria-expanded', String(!isExpanded));
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
          if (!btn.closest('.header__nav-item--dropdown').contains(e.target)) {
            btn.setAttribute('aria-expanded', 'false');
          }
        });
      });
    },
  };

  /* --------------------------------------------------------------------------
     Product Page Gallery (main-product section)
     -------------------------------------------------------------------------- */

  const ProductGallery = {
    init() {
      const gallery = document.getElementById('product-gallery');
      if (!gallery) return;

      let current = 0;
      const thumbs  = Array.from(gallery.querySelectorAll('.gallery__thumb'));
      const medias  = Array.from(gallery.querySelectorAll('.gallery__media'));

      function goTo(index) {
        thumbs[current]?.classList.remove('active');
        thumbs[current]?.setAttribute('aria-pressed', 'false');
        medias[current]?.classList.remove('active');

        current = (index + medias.length) % medias.length;

        thumbs[current]?.classList.add('active');
        thumbs[current]?.setAttribute('aria-pressed', 'true');
        medias[current]?.classList.add('active');
      }

      thumbs.forEach((thumb, i) => {
        thumb.addEventListener('click', () => goTo(i));
      });

      gallery.querySelector('[data-gallery-prev]')
        ?.addEventListener('click', () => goTo(current - 1));
      gallery.querySelector('[data-gallery-next]')
        ?.addEventListener('click', () => goTo(current + 1));
    },
  };

  /* --------------------------------------------------------------------------
     Main Product — Variant Selector (full page, not featured section)
     -------------------------------------------------------------------------- */

  const MainProductVariant = {
    init() {
      const form = document.getElementById('main-product-form');
      if (!form) return;

      const variantsData = JSON.parse(
        document.getElementById('product-variants-json')?.textContent || '[]'
      );

      if (!variantsData.length) return;

      form.addEventListener('click', (e) => {
        const btn = e.target.closest('.product-option__value');
        if (!btn) return;

        const position = parseInt(btn.dataset.optionPosition);

        form.querySelectorAll(`[data-option-position="${position}"]`).forEach(b => {
          b.classList.remove('selected');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('selected');
        btn.setAttribute('aria-checked', 'true');

        // Show selected value label (for colour swatches etc.)
        const selectedLabel = form.querySelector(`#option-selected-${position}`);
        if (selectedLabel) selectedLabel.textContent = btn.dataset.optionValue;

        this.matchVariant(form, variantsData);
      });
    },

    matchVariant(form, variants) {
      const selected = {};
      form.querySelectorAll('.product-option__value.selected').forEach(btn => {
        selected[parseInt(btn.dataset.optionPosition)] = btn.dataset.optionValue;
      });

      const match = variants.find(v =>
        v.options.every((opt, i) => opt === selected[i + 1])
      );

      if (!match) return;

      // Update hidden variant id
      form.querySelector('#main-product-variant-id').value = match.id;

      // Update price
      const priceEl = document.getElementById('main-product-price');
      if (priceEl) {
        const currency = window.Shopify?.currency?.active || 'USD';
        const locale   = document.documentElement.lang || 'en';
        const fmt = (cents) =>
          new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);

        if (match.compare_at_price && match.compare_at_price > match.price) {
          priceEl.innerHTML = `
            <span class="price price--sale">${fmt(match.price)}</span>
            <span class="price price--compare">${fmt(match.compare_at_price)}</span>
          `;
        } else {
          priceEl.innerHTML = `<span class="price">${fmt(match.price)}</span>`;
        }
      }

      // Update add to cart button
      const atcBtn = document.getElementById('main-product-atc-btn');
      if (atcBtn) {
        atcBtn.disabled     = !match.available;
        atcBtn.textContent  = match.available ? 'Add to Cart' : 'Sold Out';
      }

      // Update URL without reload
      const url = new URL(window.location.href);
      url.searchParams.set('variant', match.id);
      window.history.replaceState({}, '', url.toString());

      // Announce variant change to screen readers
      const currency = window.Shopify?.currency?.active || 'USD';
      const locale   = document.documentElement.lang || 'en';
      const fmt = (cents) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
      
      let announcement = `Variant selected. Price: ${fmt(match.price)}.`;
      if (!match.available) {
        announcement += ' This variant is sold out.';
      } else if (match.compare_at_price && match.compare_at_price > match.price) {
        announcement += ` Sale price, save ${fmt(match.compare_at_price - match.price)}.`;
      }
      A11yAnnouncer.announce(announcement);
    },
  };

  /* --------------------------------------------------------------------------
     Main Product — Add to Cart (full page)
     -------------------------------------------------------------------------- */

  const MainProductATC = {
    init() {
      const form = document.getElementById('main-product-form');
      if (!form) return;

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn      = document.getElementById('main-product-atc-btn');
        const variantId = form.querySelector('#main-product-variant-id').value;
        const qty      = parseInt(form.querySelector('[name="quantity"]').value) || 1;

        btn.disabled    = true;
        btn.textContent = 'Adding…';

        try {
          const res = await fetch('/cart/add.js', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ id: variantId, quantity: qty }),
          });
          if (res.ok) {
            const cartRes = await fetch('/cart.js');
            const cart    = await cartRes.json();
            CartDrawer.updateCartCount(cart.item_count);
            await CartDrawer.refreshDrawer(cart);
            CartDrawer.open();
          } else {
            const data = await res.json().catch(() => ({}));
            showAtcError(data.description || 'Unable to add this item to cart. Please try again.', btn);
          }
        } catch (err) {
          showAtcError('Unable to add this item to cart. Please try again.', btn);
        } finally {
          btn.disabled    = false;
          btn.textContent = 'Add to Cart';
        }
      });
    },
  };

  /* --------------------------------------------------------------------------
     Main Product — Quantity selector (page-level)
     -------------------------------------------------------------------------- */

  const QtySelector = {
    init() {
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-qty-action]');
        if (!btn) return;

        const action = btn.dataset.qtyAction;
        const input  = btn.closest('.qty-selector')?.querySelector('.qty-selector__input');
        if (!input) return;

        const current = parseInt(input.value) || 1;
        const next    = action === 'increase' ? current + 1 : Math.max(parseInt(input.min) || 1, current - 1);
        input.value   = next;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
  };

  /* --------------------------------------------------------------------------
     Cart Page — Live quantity updates
     -------------------------------------------------------------------------- */

  const CartPage = {
    init() {
      const cartForm = document.getElementById('cart-form');
      if (!cartForm) return;

      // Quantity buttons on cart page
      cartForm.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-qty-action][data-cart-key]');
        if (!btn) return;

        const key    = btn.dataset.cartKey;
        const action = btn.dataset.qtyAction;
        const input  = cartForm.querySelector(`[data-cart-qty="${key}"]`);
        if (!input) return;

        const current = parseInt(input.value) || 0;
        const next    = action === 'increase' ? current + 1 : Math.max(0, current - 1);
        input.value   = next;

        await this.updateItem(key, next);
      });

      // Remove buttons
      cartForm.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-cart-remove]');
        if (!btn) return;
        await this.updateItem(btn.dataset.cartRemove, 0);
        btn.closest('[data-cart-row]')?.remove();
      });
    },

    async updateItem(key, quantity) {
      try {
        const res  = await fetch('/cart/change.js', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id: key, quantity }),
        });
        const cart = await res.json();

        // Update subtotal
        const subtotalEl = document.getElementById('cart-subtotal');
        if (subtotalEl) {
          subtotalEl.textContent = this.formatMoney(cart.total_price);
        }

        CartDrawer.updateCartCount(cart.item_count);

        // Reload page if cart becomes empty
        if (cart.item_count === 0) {
          window.location.reload();
        }
      } catch (err) {
        console.error('Cart update failed:', err);
      }
    },

    formatMoney(cents) {
      const currency = window.Shopify?.currency?.active || 'USD';
      return new Intl.NumberFormat(document.documentElement.lang || 'en', {
        style: 'currency',
        currency,
      }).format(cents / 100);
    },
  };

  /* --------------------------------------------------------------------------
     Collection — Filter panel toggle
     -------------------------------------------------------------------------- */

  const CollectionFilters = {
    init() {
      const filterBtn    = document.querySelector('.collection-toolbar__filter-btn');
      const filterPanel  = document.getElementById('collection-filters');
      const closeBtn     = document.querySelector('[data-close-filters]');
      const overlay      = document.getElementById('overlay');

      if (!filterBtn || !filterPanel) return;

      filterBtn.addEventListener('click', () => {
        const isOpen = filterBtn.getAttribute('aria-expanded') === 'true';
        filterBtn.setAttribute('aria-expanded', String(!isOpen));
        filterPanel.setAttribute('aria-hidden', String(isOpen));
        filterPanel.classList.toggle('is-open', !isOpen);
        overlay?.classList.toggle('is-visible', !isOpen);
      });

      closeBtn?.addEventListener('click', () => this.close(filterBtn, filterPanel, overlay));
      overlay?.addEventListener('click',  () => this.close(filterBtn, filterPanel, overlay));
    },

    close(btn, panel, overlay) {
      btn.setAttribute('aria-expanded', 'false');
      panel.setAttribute('aria-hidden', 'true');
      panel.classList.remove('is-open');
      overlay?.classList.remove('is-visible');
    },
  };

  /* --------------------------------------------------------------------------
     Collection — Sort by redirect
     -------------------------------------------------------------------------- */

  const CollectionSort = {
    init() {
      document.getElementById('collection-sort')
        ?.addEventListener('change', (e) => {
          const url = new URL(window.location.href);
          url.searchParams.set('sort_by', e.target.value);
          window.location.href = url.toString();
        });
    },
  };

  /* --------------------------------------------------------------------------
     Product Recommendations — lazy load via Shopify section rendering
     -------------------------------------------------------------------------- */

  const ProductRecommendations = {
    init() {
      const section = document.querySelector('.product-recommendations[data-url]');
      if (!section) return;

      fetch(section.dataset.url)
        .then(r => r.text())
        .then(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const inner = doc.querySelector('.product-recommendations');
          if (inner) {
            section.innerHTML = inner.innerHTML;
          }
        })
        .catch(() => {});
    },
  };

  /* --------------------------------------------------------------------------
     Boot
     -------------------------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', () => {
    CartDrawer.init();
    AddToCart.init();
    VariantSelector.init();
    Gallery.init();
    MobileNav.init();
    StickyHeader.init();
    HeaderDropdown.init();

    // Page-specific
    ProductGallery.init();
    MainProductVariant.init();
    MainProductATC.init();
    QtySelector.init();
    CartPage.init();
    CollectionFilters.init();
    CollectionSort.init();
    ProductRecommendations.init();
  });

})();
