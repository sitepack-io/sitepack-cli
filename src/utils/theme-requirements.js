/**
 * What SitePack expects from a theme, in one place, so `theme:verify` checks a theme
 * against the same rules the platform applies. Each list names where it comes from:
 * when that source changes, change it here too.
 */

/**
 * The templates the storefront renders (sitepack-frontend controllers). A missing one
 * makes that page type fall back to the legacy layout or a 404.
 */
export const REQUIRED_TEMPLATES = [
    '404', 'account', 'blog', 'cart', 'category', 'legal', 'page',
    'product', 'products', 'search', 'sitemap', 'tag',
];

/**
 * Keys core recognises as the home template (sitepack-core ThemeHomeFillService): one of
 * these, or a key built around "home" such as restaurant-home.
 */
export const HOME_TEMPLATE_KEYS = ['index', 'homepage', 'home'];

export function isHomeTemplateKey(key) {
    return typeof key === 'string'
        && (HOME_TEMPLATE_KEYS.includes(key) || /(^|[-_])home(page)?([-_]|$)/.test(key));
}

/**
 * The app_block hooks every theme keeps (the official theme skeleton,
 * sitepack-dev docs/themes/template-hooks.md). Apps are built against these names, so a
 * missing hook silently hides an installed app. Grouped by the file they normally live
 * in; a theme may move one into a snippet, as long as the page type still renders it.
 */
export const REQUIRED_APP_BLOCKS = {
    'layouts/base.twig': ['head_after', 'body_start', 'body_end'],
    'snippets/header.twig': ['header_before', 'header_after'],
    'snippets/footer.twig': ['footer_before', 'footer_after'],
    'home template': ['index_before', 'index_after'],
    'templates/product.twig': [
        'product_details_before', 'product_details_after',
        'product_gallery_before', 'product_gallery_after',
        'product_image_before', 'product_image_after',
        'product_price_before', 'product_price_after',
        'product_meta_before', 'product_meta_after',
        'product_stock_before', 'product_stock_after',
        'product_short_description_before', 'product_short_description_after',
        'product_usps',
        'product_description_before', 'product_description_after',
        'product_specifications_before', 'product_specifications_after',
        'product_downloads_before', 'product_downloads_after',
        'product_form_before', 'product_form_after',
        'product_recommendations_before', 'product_recommendations_after',
    ],
    'snippets/product-card.twig': [
        'product_card_before', 'product_card_after',
        'product_card_image_before', 'product_card_info_before', 'product_card_info_after',
    ],
    'templates/category.twig': ['category_before', 'category_after'],
    'templates/products.twig': ['products_before', 'products_after'],
    'templates/search.twig': ['search_before', 'search_after'],
    'templates/cart.twig': ['cart_before', 'cart_after'],
    'templates/blog.twig': [
        'blog_before', 'blog_after',
        'article_image_before', 'article_image_after',
        'article_content_before', 'article_content_after',
        'article_tag_before', 'article_tag_after',
    ],
    'snippets/blog-card.twig': ['blog_article_image_before', 'blog_article_image_after'],
    'templates/tag.twig': ['tag_before', 'tag_after', 'tag_article_before', 'tag_article_after'],
    'templates/page.twig': ['page_before', 'page_after'],
    'templates/legal.twig': ['legal_page_before', 'legal_page_after'],
    'templates/404.twig': ['error_404_before', 'error_404_after'],
};

/**
 * Platform functions that render the hooks and widgets apps rely on: sitepack_head()
 * prints the apps' `head` blocks, sitepack_account() and sitepack_product_options() carry
 * the account_* and product_variants_* hooks.
 */
export const REQUIRED_FUNCTIONS = [
    { name: 'sitepack_head', where: 'layouts/', why: 'prints the platform CSS and the `head` blocks of installed apps' },
    { name: 'sitepack_scripts', where: 'layouts/', why: 'loads the platform scripts (cart, consent, SDK)' },
    { name: 'sitepack_cookies', where: 'layouts/', why: 'renders the cookie consent bar' },
    { name: 'sitepack_account', where: 'templates/account.twig', why: 'renders the account section and its account_* hooks' },
    { name: 'sitepack_cart', where: 'templates/cart.twig', why: 'renders the cart' },
    { name: 'sitepack_product_options', where: 'templates/product.twig', why: 'renders the variant picker and its product_variants_* hooks', level: 'warning' },
];

/**
 * The languages every theme ships, the same four sitepack.eu and the marketplace
 * listings are published in. English is the fallback for every other language.
 */
export const REQUIRED_LANGUAGES = ['en', 'nl', 'de', 'es'];
export const FALLBACK_LANGUAGE = 'en';

/**
 * What the Twig sandbox lets a theme use: the overlap of the publish gate
 * (sitepack-devcdn SitePackSecurityPolicy) and the render sandbox (sitepack-frontend
 * SitePackSandboxPolicy). Something only one of them allows either fails to publish or
 * fails to render.
 */
export const ALLOWED_TAGS = ['if', 'elseif', 'else', 'for', 'set', 'include', 'extends', 'block', 'trans', 'app_block'];

export const ALLOWED_FILTERS = [
    'escape', 'format', 'date', 'trans', 'asset_url', 'replace', 'length', 'join', 'merge',
    'slice', 'number_format', 'url_encode', 'default', 'first', 'last', 'keys', 'upper',
    'lower', 'capitalize', 'title', 'trim', 'abs', 'round', 'striptags', 'nl2br', 'sort',
    'reverse', 'filter', 'ensure_link', 'json_encode', 'sitepack_html', 'sitepack_json',
];

export const ALLOWED_FUNCTIONS = [
    'range', 'constant', 'cycle', 'random', 'date', 'max', 'min', 'ensure_link',
    'theme_asset', 'theme_setting',
    'sitepack_head', 'sitepack_title', 'sitepack_scripts', 'sitepack_cookies',
    'sitepack_navigation', 'sitepack_breadcrumbs',
    'sitepack_translations', 'sitepack_translations_list', 'sitepack_languages',
    'sitepack_language_switcher', 'sitepack_language_name', 'sitepack_language_flag',
    'sitepack_slug', 'sitepack_account_slug', 'sitepack_product_slug', 'sitepack_category_slug',
    'sitepack_blog_slug', 'sitepack_legal_slug', 'sitepack_post_slug',
    'sitepack_content', 'sitepack_elements', 'sitepack_content_legal', 'sitepack_footer',
    'sitepack_legal_links', 'sitepack_copyright', 'sitepack_icon',
    'sitepack_live_search', 'sitepack_live_search_icon', 'sitepack_shopping_cart_icon',
    'sitepack_newsletter_form', 'sitepack_usps', 'sitepack_locations', 'sitepack_topbar',
    'sitepack_events', 'sitepack_blogs', 'sitepack_posts', 'sitepack_post', 'sitepack_reviews',
    'app_block', 'calculate_text_color', 'calculate_brightness', 'sitepack_price',
    'sitepack_products', 'sitepack_categories', 'sitepack_product_options', 'sitepack_cart',
    'sitepack_account', 'sitepack_category_filters', 'sitepack_json_ld',
    'sitepack_is_color_filter', 'sitepack_color_swatch', 'csrf_token',
];

/** Replacements for the things themes most often reach for. */
export const SANDBOX_HINTS = {
    raw: 'use |sitepack_html for rich text or |sitepack_json inside a script tag',
    e: 'use |escape',
    truncate: "use |striptags|slice(0, 160)",
    split: 'build the list in theme.json (a list field) instead',
    batch: 'loop with loop.index and a modulo check instead',
    macro: 'move the markup to a snippet and include it',
    import: 'move the markup to a snippet and include it',
    embed: "use {% include 'snippets/x.twig' with {...} %}",
    with: "use {% include 'snippets/x.twig' with {...} %}",
    img_url: "use |asset_url for theme assets",
};

/**
 * The theme directory layout devcdn accepts (sitepack-devcdn DirectoryStructurePolicy).
 * An upload outside it is refused with a 422, which aborts `theme:publish`.
 */
export const ROOT_FILES = ['theme.json', 'themes.json'];

export const DIRECTORIES = {
    assets: {
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'json', 'pdf', 'woff', 'woff2', 'ttf', 'otf'],
        subdirectories: ['css', 'js', 'img', 'fonts'],
    },
    layouts: { extensions: ['twig'] },
    snippets: { extensions: ['twig'] },
    templates: { extensions: ['twig'] },
    translations: { extensions: ['json'], lowercase: true },
};

/** Field types core accepts in theme.json (sitepack-core ThemeFieldTypeEnum). */
export const FIELD_TYPES = [
    'colour', 'text', 'textarea', 'image', 'media', 'file', 'list', 'font', 'options', 'pixels', 'icon', 'boolean',
];

/** The platform colours a theme may fill through `platform_colors` (sitepack-core ThemeConfig). */
export const PLATFORM_COLOR_KEYS = [
    'main-color', 'main-color-text', 'secondary-color', 'secondary-color-text', 'link-color', 'link-active-color',
];

/**
 * CSS variables the platform always provides on a custom theme page, next to the ones
 * generated from the theme's own settings.
 */
export const PLATFORM_CSS_VARIABLES = [
    'heading-font', 'body-font',
    'main-color', 'main-color-text', 'secondary-color', 'secondary-color-text',
    'link-color', 'link-active-color', 'link-text-decoration', 'border-radius', 'container-width',
];
