import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

// AEM instance and GraphQL persisted query endpoint
const AEM_AUTHOR_URL = 'https://author-p9606-e71941.adobeaemcloud.com';
const GRAPHQL_ENDPOINT = '/graphql/execute.json/jan-cf-models/getProductCreditCardByPath;path=';

/**
 * Logs messages with timestamp and context for better tracing
 * @param {string} level - Log level (info, warn, error)
 * @param {string} message - Log message
 * @param {object} data - Additional data to log
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [PRODUCTS-BLOCK] ${message}`;
  
  if (data) {
    console[level](logMessage, data);
  } else {
    console[level](logMessage);
  }
}

/**
 * Fetches product data by content fragment path using AEM GraphQL persisted query
 * @param {string} contentPath - Path to the content fragment
 * @returns {Promise<object>} Content fragment data
 */
async function getProductDataByContentPath(contentPath) {
  log('info', `Fetching content fragment: ${contentPath}`);
  
  try {
    const url = `${AEM_AUTHOR_URL}${GRAPHQL_ENDPOINT}${contentPath}`;
    
    log('info', 'Making GraphQL request', { url, contentPath });
    
    const options = { credentials: 'include' };
    const response = await fetch(url, options);
    
    log('info', 'Response received', {
      status: response.status,
      statusText: response.statusText,
      url: response.url
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
    }
    
    const cf = await response.json();
    log('info', 'GraphQL response parsed', cf);
    
    const cfData = cf?.data?.productCreditCardModelByPath?.item || '';
    
    if (!cfData) {
      log('warn', 'No product data found in response', { contentPath, response: cf });
      return null;
    }
    
    log('info', 'Product data fetched successfully', cfData);
    return cfData;
    
  } catch (error) {
    log('error', `Failed to fetch GraphQL Data: ${error.message}`, { 
      contentPath, 
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    });
    throw new Error(`Failed to fetch GraphQL Data: ${error.message}`);
  }
}

/**
 * Creates a product card element from content fragment data
 * @param {string} productName - Product name from the block
 * @param {object} fragmentData - Content fragment data
 * @returns {HTMLElement} Product card element
 */
function createProductCard(productName, fragmentData) {
  log('info', 'Creating product card', { productName, fragmentData });
  
  const li = document.createElement('li');
  li.className = 'product-card';

  if (!fragmentData) {
    // Fallback content if fragment data is not available
    li.className = 'product-card product-error';
    li.innerHTML = `
      <div class="product-card-body">
        <h3>${productName || 'Product'}</h3>
        <p>Content fragment data not available</p>
      </div>
    `;
    return li;
  }

  // Create image container if creditCardImage is available
  let imageHtml = '';
  if (fragmentData.creditCardImage?._authorUrl) {
    const authorUrl = fragmentData.creditCardImage._authorUrl;
    const altText = fragmentData.creditCardName || 'Credit Card';
    
    log('info', 'Using direct author URL for image', { authorUrl, altText });
    
    // Create picture element with direct author URL (no optimization)
    const picture = document.createElement('picture');
    const img = document.createElement('img');
    img.src = authorUrl;
    img.alt = altText;
    img.loading = 'lazy';
    picture.appendChild(img);
    
    imageHtml = `<div class="product-card-image">${picture.outerHTML}</div>`;
  }

  // Extract plaintext content from rich text fields and format for HTML
  const description = fragmentData.creditCardDescription?.plaintext || '';
  const promo = fragmentData.promo?.plaintext || '';
  const notes = fragmentData.notes?.plaintext || '';

  // Format text content by converting line breaks to HTML and structure content
  const formatText = (text) => {
    if (!text) return '';
    return text
      .replace(/\u003E/g, '>')      // Convert encoded > characters
      .trim();
  };

  // Format promo content with proper structure
  const formatPromoContent = (promoText) => {
    if (!promoText) return '';
    
    const formatted = formatText(promoText);
    const lines = formatted.split('\n').filter(line => line.trim());
    
    let content = '';
    lines.forEach((line, index) => {
      if (line.includes('special offer:') || line.includes('Rewards special offer:')) {
        content += `<h4>${line}</h4>`;
      } else {
        content += `<p>${line}</p>`;
      }
    });
    
    return content;
  };

  // Format notes content with proper structure
  const formatNotesContent = (notesText) => {
    if (!notesText) return '';
    
    const formatted = formatText(notesText);
    const lines = formatted.split('\n').filter(line => line.trim());
    
    let content = '<h4>Important numbers for new cards:</h4>';
    lines.forEach((line, index) => {
      if (index === 0 && line.includes('Important numbers')) {
        return; // Skip the title line as we've already added it
      }
      if (line.trim()) {
        content += `<p>${line}</p>`;
      }
    });
    
    return content;
  };

  // Create card content
  const cardContent = `
    ${imageHtml}
    <div class="product-card-body">
      <h3 class="product-title">${fragmentData.creditCardName || productName || 'Product'}</h3>
      ${description ? `<div class="product-description">${formatText(description)}</div>` : ''}
      ${promo ? `<div class="product-promo">${formatPromoContent(promo)}</div>` : ''}
      ${notes ? `<div class="product-notes">${formatNotesContent(notes)}</div>` : ''}
      <div class="product-cta">
        <a href="#" class="product-cta-button">Find out more</a>
      </div>
    </div>
  `;

  li.innerHTML = cardContent;
  
  log('info', 'Product card created successfully');
  return li;
}

/**
 * Parses product items from the block DOM
 * @param {HTMLElement} block - The products block element
 * @returns {Array} Array of product items with name and fragment path
 */
function parseProductItems(block) {
  log('info', 'Parsing product items from block');
  
  const items = [];
  const rows = [...block.children];
  
  rows.forEach((row, index) => {
    const cells = [...row.children];
    if (cells.length >= 2) {
      const productName = cells[0]?.textContent?.trim() || '';
      const fragmentPath = cells[1]?.textContent?.trim() || '';
      
      if (fragmentPath) {
        items.push({ productName, fragmentPath });
        log('info', `Parsed product item ${index + 1}`, { productName, fragmentPath });
      } else {
        log('warn', `Product item ${index + 1} missing fragment path`, { productName });
      }
    } else {
      log('warn', `Product item ${index + 1} has insufficient cells`, { cellCount: cells.length });
    }
  });
  
  log('info', `Parsed ${items.length} product items`);
  return items;
}

/**
 * Main decorator function for the products block
 * @param {HTMLElement} block - The products block element
 */
export default async function decorate(block) {
  log('info', 'Starting products block decoration');
  
  try {
    // Parse product items from the block
    const productItems = parseProductItems(block);
    
    if (productItems.length === 0) {
      log('warn', 'No product items found in block');
      block.style.display = 'block';
      block.innerHTML = '<p>No products to display</p>';
      return;
    }

    // Create title section
    const titleSection = document.createElement('div');
    titleSection.className = 'products-title';
    titleSection.innerHTML = '<h2>Your card options</h2>';

    // Create container for products
    const ul = document.createElement('ul');

    // Show loading state (without flex layout during loading)
    block.style.display = 'block';
    block.innerHTML = '<div class="products-loading">Loading products...</div>';
    
    // Fetch content fragment data for each product item
    const productCards = await Promise.all(
      productItems.map(async (item) => {
        log('info', `Processing product item: ${item.productName}`);
        
        try {
          const fragmentData = await getProductDataByContentPath(item.fragmentPath);
          const card = createProductCard(item.productName, fragmentData);
          moveInstrumentation(block, card);
          return card;
        } catch (error) {
          log('error', `Failed to process product item: ${item.productName}`, error);
          return createProductCard(item.productName, null);
        }
      })
    );

    // Add all cards to the list
    productCards.forEach(card => {
      if (card) {
        ul.appendChild(card);
      }
    });

    // Replace block content with title and products list
    block.innerHTML = '';
    block.style.display = ''; // Reset to use CSS flex layout
    block.appendChild(titleSection);
    block.appendChild(ul);
    
    log('info', `Products block decoration completed with ${productCards.length} items`);
    
  } catch (error) {
    log('error', 'Failed to decorate products block', error);
    block.style.display = 'block';
    block.innerHTML = '<p class="products-error">Failed to load products. Please try again later.</p>';
  }
}
