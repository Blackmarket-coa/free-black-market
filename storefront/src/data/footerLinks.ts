import { GITHUB_REPO_URL } from '@/lib/constants/links'

const links = {
  customerServices: [
    { label: 'Shop by Category', path: '/categories' },
    { label: 'Our Producers', path: '/producers' },
    { label: 'Track Order', path: '/user/orders' },
    { label: 'Collective Buys', path: '/collective/demand-pools' },
    { label: 'Community Resources', path: '/community-resources' },
    { label: 'Feature Matrix', path: '/feature-matrix' },
    { label: 'Community Donations', path: '/donations' },
    { label: 'Returns', path: '/user/returns' },
    { label: 'Buyer Protection', path: '/buyer-protection' },
  ],
  about: [
    { label: 'About Us', path: 'https://www.blackmarketcoa.com' },
    { label: 'How It Works', path: '/how-it-works' },
    { label: 'Fee Transparency', path: '/transparency' },
    { label: 'How Verification Works', path: '/verification' },
    { label: 'The KARMA Ladder', path: '/karma' },
    { label: 'How Governance Works', path: '/governance' },
    { label: 'Vendor Types & Features', path: '/vendor-types' },
    { label: 'What Are You Selling?', path: '/what-you-sell' },
    { label: 'Feature Matrix', path: '/feature-matrix' },
    { label: 'Beyond Selling', path: '/beyond-selling' },
    { label: 'Why We Exist', path: '/why-we-exist' },
    { label: 'Become a Provider', path: '/sell' },
    { label: 'Community Gardens', path: '/gardens' },
    { label: 'Community Kitchens', path: '/kitchens' },
    { label: 'Invest', path: '/invest' },
  ],
  connect: [
    { label: 'GitHub Transparency', path: GITHUB_REPO_URL },
    { label: 'TikTok', path: 'https://www.tiktok.com/@blackmarketcoa' },
    { label: 'Instagram', path: 'https://www.instagram.com/blackmarket_coalition' },
  ],
};

export default links;
