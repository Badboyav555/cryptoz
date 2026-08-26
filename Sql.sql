-- =============================================
-- CRYPTO WALLET SIMULATOR — SUPABASE SCHEMA
-- =============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    mobile TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS profiles (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    username TEXT,
    email TEXT,
    avatar_url TEXT,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    btc_balance NUMERIC(20,8) DEFAULT 0,
    eth_balance NUMERIC(20,8) DEFAULT 0,
    usdt_balance NUMERIC(20,8) DEFAULT 0,
    sol_balance NUMERIC(20,8) DEFAULT 0,
    xrp_balance NUMERIC(20,8) DEFAULT 0,
    doge_balance NUMERIC(20,8) DEFAULT 0,
    bnb_balance NUMERIC(20,8) DEFAULT 0,
    inr_balance NUMERIC(20,2) DEFAULT 0,
    wallet_address TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    receiver_id UUID REFERENCES users(id) ON DELETE SET NULL,
    coin TEXT NOT NULL,
    amount NUMERIC(20,8) NOT NULL,
    amount_inr NUMERIC(20,2),
    tx_hash TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirming','completed','failed')),
    confirmations INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    coin TEXT NOT NULL,
    crypto_amount NUMERIC(20,8) NOT NULL,
    amount_inr NUMERIC(20,2),
    withdrawal_method TEXT CHECK (withdrawal_method IN ('upi','bank')),
    upi_id TEXT,
    bank_name TEXT,
    account_holder_name TEXT,
    account_number TEXT,
    ifsc_code TEXT,
    status TEXT DEFAULT 'processing' CHECK (status IN ('processing','approved','completed','rejected')),
    processing_days_remaining INTEGER DEFAULT 3,
    estimated_arrival TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read_status BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_prices (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    coin_name TEXT NOT NULL,
    symbol TEXT NOT NULL UNIQUE,
    current_price_inr NUMERIC(20,2),
    change_percentage NUMERIC(10,2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, symbol)
);

CREATE TABLE IF NOT EXISTS daily_rewards (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reward_amount NUMERIC(20,8) DEFAULT 0.0001,
    reward_coin TEXT DEFAULT 'btc',
    claimed_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, DATE(claimed_at))
);

CREATE TABLE IF NOT EXISTS referrals (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    referrer_id UUID REFERENCES users(id) ON DELETE CASCADE,
    referred_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    referral_code TEXT UNIQUE,
    reward_amount NUMERIC(20,8) DEFAULT 0,
    reward_coin TEXT DEFAULT 'usdt',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "u_all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "p_all" ON profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "w_all" ON wallets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "t_all" ON transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "wd_all" ON withdrawals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "n_all" ON notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "m_all" ON market_prices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "wl_all" ON watchlist FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "dr_all" ON daily_rewards FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "r_all" ON referrals FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_wallets_uid ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_sender ON transactions(sender_id);
CREATE INDEX IF NOT EXISTS idx_tx_receiver ON transactions(receiver_id);
CREATE INDEX IF NOT EXISTS idx_wd_uid ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_noti_uid ON notifications(user_id);

-- Default admin (password: admin123)
INSERT INTO users (username, email, mobile, password_hash, role, is_active)
VALUES ('admin','admin@wallet.io','9999999999',
'240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9','admin',true)
ON CONFLICT (mobile) DO NOTHING;

-- Default market prices
INSERT INTO market_prices (coin_name, symbol, current_price_inr, change_percentage) VALUES
('Bitcoin','btc',8250000,2.5),
('Ethereum','eth',225000,1.8),
('Solana','sol',18500,-0.5),
('XRP','xrp',245,3.2),
('Dogecoin','doge',28.5,-1.2),
('BNB','bnb',72000,0.8),
('Tether','usdt',83.5,0.01)
ON CONFLICT (symbol) DO NOTHING;
