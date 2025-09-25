# SIT103 9.2D - Watch List Manager

A modern desktop application for managing your personal movie and TV show watch list, built with Tauri 2.0 and SolidJS.

## Features

- **Movie & TV Show Tracking** - Add movies and TV shows with ratings (1-10)
- **Duplicate Prevention** - Smart duplicate detection prevents adding the same title twice
- **Watch Again Tracking** - Mark items you'd watch again for easy reference
- **Secure Authentication** - Database login system with user credentials
- **Real-time Validation** - Client and server-side input validation with toggle modes
- **Developer Mode** - Testing interface for validation bypassing
- **Modern UI** - Dark theme with responsive design

## Tech Stack

### Frontend
- **SolidJS** - Reactive JavaScript framework with TypeScript
- **shadcn-solid** - Modern UI component library
- **Tailwind CSS** - Utility-first CSS framework
- **Vite** - Fast build tool and development server

### Backend
- **Rust** - High-performance systems programming language
- **Tauri 2.0** - Cross-platform desktop app framework
- **SQLx** - Async SQL toolkit with compile-time query verification
- **Tokio** - Async runtime for Rust

### Database
- **PostgreSQL** - Robust relational database
- **Remote hosting** - Cloud-hosted with SSL/TLS encryption

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)
- [PostgreSQL](https://www.postgresql.org/) database access with valid credentials

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/tomm-aus/SIT103-9.2D
   cd SIT10392D
   ```

2. **Install dependencies**
   - If running on Mac please use the package.mac.json instead of the windows deps in package.json
   ```bash
   npm install
   ```

## Development

To run the application in development mode:

```bash
npm run tauri dev
```

This will start both the frontend development server and the Tauri application.

## Building

Create a production build:

```bash
npm run tauri build
```

The built application will be available in the `src-tauri/target/release/bundle/` directory.

## Usage

1. **Authentication**: Enter your database username and password when prompted
2. **Add Items**: Select Movie or TV Show, enter the name, rate it 1-10, and optionally mark if you'd watch again
3. **Manage List**: View all your items, select multiple for batch deletion
4. **Developer Mode**: Toggle validation modes to test security features

## Database Schema

The application uses the following table structure:

```sql
CREATE TABLE watch_list (
    id SERIAL PRIMARY KEY,
    media_type VARCHAR(10) NOT NULL CHECK (media_type IN ('movie', 'tv')),
    name VARCHAR(200) NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10),
    would_watch_again BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Table Description

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Auto-incrementing primary key |
| `media_type` | VARCHAR(10) | Type: 'movie' or 'tv' (required) |
| `name` | VARCHAR(200) | Title of the movie/show (required) |
| `rating` | INTEGER | User rating 1-10 (required) |
| `would_watch_again` | BOOLEAN | Whether user would rewatch |
| `created_at` | TIMESTAMP | Auto-generated creation time |

### Required Database Permissions

The application requires the following minimum permissions:
```sql
GRANT SELECT, INSERT, DELETE, TRUNCATE ON TABLE watch_list TO your_username;
GRANT USAGE, SELECT ON SEQUENCE watch_list_id_seq TO your_username;
GRANT USAGE ON SCHEMA public TO your_username;
```

## Security Features

- **Authentication System** - Secure database login with credential validation
- **Parameterized Queries** - All database operations use SQLx parameter binding
- **Duplicate Detection** - Case-insensitive duplicate prevention with database checks
- **Input Sanitization** - HTML entity encoding and character filtering
- **SQL Injection Protection** - Compile-time query verification
- **Validation Modes** - Toggle between client and server-side validation
- **SSL/TLS Encryption** - Secure database connections

## Project Structure

```
watch-list/
├── src/                    # Frontend SolidJS code
│   ├── components/ui/      # shadcn-solid components
│   ├── App.tsx            # Main application component
│   └── App.css            # Modern dark theme styling
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── main.rs        # Rust entry point
│   │   ├── lib.rs         # Main Tauri setup
│   │   └── database.rs    # Database operations & auth
│   └── Cargo.toml         # Rust dependencies
├── package.json           # Frontend dependencies
└── README.md             # This file
```

## Key Functions

### Authentication
- Login with database credentials
- Session management with automatic logout
- Connection testing and permission verification

### Watch List Management
- Add movies and TV shows with ratings
- Smart duplicate detection by name and type
- Batch selection and deletion
- Real-time statistics display

### Developer Features
- Validation mode toggle (client vs server-side)
- Security testing interface
- Detailed error reporting

## Acknowledgments

- [Tauri](https://tauri.app/) - For the excellent desktop app framework
- [SolidJS](https://www.solidjs.com/) - For the reactive frontend framework
- [shadcn-solid](https://shadcn-solid.com/) - For the beautiful UI components
- [SQLx](https://github.com/launchbadge/sqlx) - For type-safe database operations