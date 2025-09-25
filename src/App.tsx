import { Component, createSignal, onMount, Show, For } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import { Button } from './components/ui/button';
import { TextField, TextFieldRoot, TextFieldLabel } from './components/ui/textfield';
import {Checkbox, CheckboxControl} from './components/ui/checkbox';
import { Badge } from './components/ui/badge';
import './App.css';
import {toast} from "solid-toast";

type MediaType = 'movie' | 'tv';

interface WatchListItem {
    id?: number;
    media_type: MediaType;
    name: string;
    rating: number;
    would_watch_again: boolean;
}

interface DatabaseResponse {
    success: boolean;
    message: string;
    rows_affected: number;
    data?: WatchListItem[];
}

interface AuthResponse {
    success: boolean;
    message: string;
}

interface DatabaseCredentials {
    username: string;
    password: string;
}

interface ValidationError {
    field: string;
    message: string;
}

// Validation constants
const MAX_NAME_LENGTH = 200;
const MIN_RATING = 1;
const MAX_RATING = 10;
const MAX_BATCH_DELETE_SIZE = 100;

// Validation patterns
const NAME_PATTERN = /^[a-zA-Z0-9\s\.,!?\-_()':;&]+$/;

// Sanitization function
const sanitizeString = (input: string): string => {
    return input
        .trim()
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .replace(/[^\x20-\x7E\u00C0-\u017F\u0100-\u024F]/g, '')
        .slice(0, MAX_NAME_LENGTH);
};

// Validation functions
const validateName = (name: string): ValidationError | null => {
    const trimmed = name.trim();

    if (!trimmed) {
        return { field: 'name', message: 'Name cannot be empty' };
    }

    if (trimmed.length > MAX_NAME_LENGTH) {
        return { field: 'name', message: `Name cannot exceed ${MAX_NAME_LENGTH} characters` };
    }

    if (!NAME_PATTERN.test(trimmed)) {
        return { field: 'name', message: 'Name contains invalid characters. Only letters, numbers, spaces, and basic punctuation are allowed' };
    }

    return null;
};

const validateRating = (rating: number): ValidationError | null => {
    if (rating < MIN_RATING || rating > MAX_RATING) {
        return { field: 'rating', message: `Rating must be between ${MIN_RATING} and ${MAX_RATING}` };
    }

    if (!Number.isInteger(rating)) {
        return { field: 'rating', message: 'Rating must be a whole number' };
    }

    return null;
};

const validateWatchListItem = (item: WatchListItem): ValidationError[] => {
    const errors: ValidationError[] = [];

    const nameError = validateName(item.name);
    if (nameError) errors.push(nameError);

    const ratingError = validateRating(item.rating);
    if (ratingError) errors.push(ratingError);

    return errors;
};

const App: Component = () => {
    // Authentication state
    const [isAuthenticated, setIsAuthenticated] = createSignal(false);
    const [loginCredentials, setLoginCredentials] = createSignal<DatabaseCredentials>({
        username: '',
        password: ''
    });
    const [loginLoading, setLoginLoading] = createSignal(false);
    const [showPassword, setShowPassword] = createSignal(false);

    // Watch list state
    const [watchList, setWatchList] = createSignal<WatchListItem[]>([]);
    const [selectedIds, setSelectedIds] = createSignal<number[]>([]);
    const [loading, setLoading] = createSignal(false);
    const [validationErrors, setValidationErrors] = createSignal<ValidationError[]>([]);

    // Validation mode toggle
    const [clientValidationEnabled, setClientValidationEnabled] = createSignal(true);
    const [developerMode, setDeveloperMode] = createSignal(false);

    // Form state
    const [formData, setFormData] = createSignal<WatchListItem>({
        media_type: 'movie',
        name: '',
        rating: 5,
        would_watch_again: false
    });

    // Authentication functions
    const handleLogin = async () => {
        const credentials = loginCredentials();

        if (!credentials.username.trim()) {
            createToast(false, 'Username is required');
            return;
        }

        if (!credentials.password.trim()) {
            createToast(false, 'Password is required');
            return;
        }

        setLoginLoading(true);
        try {
            const response: AuthResponse = await invoke('authenticate', { credentials });
            if (response.success) {
                setIsAuthenticated(true);
                createToast(true, response.message);
                // Clear credentials from memory after successful login
                setLoginCredentials({ username: '', password: '' });
                // Load watch list after successful authentication
                await loadWatchList();
            } else {
                createToast(false, response.message);
            }
        } catch (error) {
            console.error('Login error:', error);
            createToast(false, 'Failed to authenticate');
        }
        setLoginLoading(false);
    };

    const handleLogout = async () => {
        try {
            const response: AuthResponse = await invoke('logout');
            if (response.success) {
                setIsAuthenticated(false);
                setWatchList([]);
                setSelectedIds([]);
                createToast(true, response.message);
            } else {
                createToast(false, response.message);
            }
        } catch (error) {
            console.error('Logout error:', error);
            createToast(false, 'Failed to logout');
        }
    };

    const showValidationErrors = (errors: ValidationError[]) => {
        setValidationErrors(errors);
        setTimeout(() => setValidationErrors([]), 10000);
    };

    const loadWatchList = async () => {
        if (!isAuthenticated()) return;

        setLoading(true);
        try {
            const response: DatabaseResponse = await invoke('get_all_watch_items');
            if (response.success && response.data) {
                setWatchList(response.data);
                createToast(true, response.message);
            } else {
                createToast(false, response.message);
                // If authentication error, logout
                if (response.message.includes('Authentication required')) {
                    setIsAuthenticated(false);
                }
            }
        } catch (error) {
            console.error('Error loading watch list:', error);
            createToast(false, 'Failed to load watch list');
        }
        setLoading(false);
    };

    const insertWatchItem = async () => {
        if (!isAuthenticated()) return;

        setValidationErrors([]);

        if (clientValidationEnabled()) {
            const errors = validateWatchListItem(formData());
            if (errors.length > 0) {
                showValidationErrors(errors);
                return;
            }
        }

        const itemData: WatchListItem = clientValidationEnabled() ? {
            ...formData(),
            name: sanitizeString(formData().name)
        } : {
            ...formData()
        };

        setLoading(true);
        try {
            const response: DatabaseResponse = await invoke('insert_watch_item', { item: itemData });
            if (response.success) {
                createToast(true, response.message);
                setFormData({
                    media_type: 'movie',
                    name: '',
                    rating: 5,
                    would_watch_again: false
                });
                await loadWatchList();
            } else {
                createToast(false, response.message);
                if (response.message.includes('Authentication required')) {
                    setIsAuthenticated(false);
                }
            }
        } catch (error) {
            console.error('Error adding item:', error);
            createToast(false, 'Failed to add item');
        }
        setLoading(false);
    };

    const deleteSelectedItems = async () => {
        if (!isAuthenticated()) return;

        const selected = selectedIds();

        if (selected.length === 0) {
            createToast(false, 'No items selected for deletion');
            return;
        }

        if (clientValidationEnabled()) {
            if (selected.length > MAX_BATCH_DELETE_SIZE) {
                createToast(false, `Cannot delete more than ${MAX_BATCH_DELETE_SIZE} items at once`);
                return;
            }

            const invalidIds = selected.filter(id => !Number.isInteger(id) || id <= 0);
            if (invalidIds.length > 0) {
                createToast(false, 'Invalid item IDs detected');
                return;
            }
        }

        setLoading(true);
        try {
            const response: DatabaseResponse = await invoke('delete_watch_items', { ids: selected });
            if (response.success) {
                createToast(true, response.message);
                setSelectedIds([]);
                await loadWatchList();
            } else {
                createToast(false, response.message);
                if (response.message.includes('Authentication required')) {
                    setIsAuthenticated(false);
                }
            }
        } catch (error) {
            console.error('Error deleting items:', error);
            createToast(false, 'Failed to delete items');
        }
        setLoading(false);
    };

    const toggleSelection = (id: number) => {
        if (!Number.isInteger(id) || id <= 0) return;

        const current = selectedIds();
        if (current.includes(id)) {
            setSelectedIds(current.filter(i => i !== id));
        } else {
            setSelectedIds([...current, id]);
        }
    };

    const selectAll = () => {
        const allIds = watchList()
            .map(item => item.id!)
            .filter(id => Number.isInteger(id) && id > 0);
        setSelectedIds(selectedIds().length === allIds.length ? [] : allIds);
    };

    const getRatingLabel = (rating: number) => {
        if (rating >= 8) return 'Excellent';
        if (rating >= 6) return 'Good';
        if (rating >= 4) return 'Average';
        return 'Poor';
    };

    const getRatingColor = (rating: number) => {
        if (rating >= 8) return 'excellent';
        if (rating >= 6) return 'good';
        if (rating >= 4) return 'average';
        return 'poor';
    };

    const getMediaTypeIcon = (mediaType: MediaType) => {
        return mediaType === 'movie' ? '🎬' : '📺';
    };

    const getMediaTypeLabel = (mediaType: MediaType) => {
        return mediaType === 'movie' ? 'Movie' : 'TV Show';
    };

    // Form input handlers
    const handleNameInput = (value: string) => {
        if (clientValidationEnabled()) {
            const sanitized = sanitizeString(value).slice(0, MAX_NAME_LENGTH);
            setFormData(prev => ({ ...prev, name: sanitized }));
        } else {
            setFormData(prev => ({ ...prev, name: value }));
        }
    };

    const handleRatingInput = (value: string) => {
        const num = parseInt(value, 10);
        if (isNaN(num)) return;

        if (clientValidationEnabled()) {
            const clamped = Math.max(MIN_RATING, Math.min(MAX_RATING, num));
            setFormData(prev => ({ ...prev, rating: clamped }));
        } else {
            setFormData(prev => ({ ...prev, rating: num }));
        }
    };

    const toggleDeveloperMode = () => {
        setDeveloperMode(!developerMode());
    };

    const toggleValidationMode = () => {
        setClientValidationEnabled(!clientValidationEnabled());
        setValidationErrors([]);
    };

    const createToast = (success: boolean, message: string) => {
        if(success){
            toast.success(message)
        }else{
            toast.error(message)
        }
    };

    // Login form handlers
    const handleUsernameInput = (value: string) => {
        setLoginCredentials(prev => ({ ...prev, username: value }));
    };

    const handlePasswordInput = (value: string) => {
        setLoginCredentials(prev => ({ ...prev, password: value }));
    };

    onMount(() => {
        // Don't load watch list on mount - wait for authentication
    });

    // Login Screen
    const LoginScreen = () => (
        <div class="login-screen">
            <div class="login-container">
                <div class="login-header">
                    <h1 class="login-title">Watch List Database</h1>
                    <p class="login-subtitle">Enter your database credentials to continue</p>
                </div>

                <form class="login-form" onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
                    <div class="form-group">
                        <TextFieldRoot>
                            <TextFieldLabel class="form-label">Database Username</TextFieldLabel>
                            <TextField
                                class="form-input"
                                type="text"
                                value={loginCredentials().username}
                                onInput={(e) => handleUsernameInput(e.currentTarget.value)}
                                placeholder="Enter database username..."
                                required
                                disabled={loginLoading()}
                            />
                        </TextFieldRoot>
                    </div>

                    <div class="form-group">
                        <TextFieldRoot>
                            <TextFieldLabel class="form-label">Database Password</TextFieldLabel>
                            <div class="password-field">
                                <TextField
                                    class="form-input password-input"
                                    type={showPassword() ? "text" : "password"}
                                    value={loginCredentials().password}
                                    onInput={(e) => handlePasswordInput(e.currentTarget.value)}
                                    placeholder="Enter database password..."
                                    required
                                    disabled={loginLoading()}
                                />
                                <Button
                                    type="button"
                                    class="password-toggle"
                                    onClick={() => setShowPassword(!showPassword())}
                                    disabled={loginLoading()}
                                >
                                    {showPassword() ? '🙈' : '👁️'}
                                </Button>
                            </div>
                        </TextFieldRoot>
                    </div>

                    <Button
                        type="submit"
                        disabled={loginLoading() || !loginCredentials().username.trim() || !loginCredentials().password.trim()}
                        class="login-btn"
                    >
                        {loginLoading() ? 'Connecting...' : 'Connect to Database'}
                    </Button>
                </form>

                <div class="login-info">
                    <p class="info-text">
                        This application requires direct database access. Your credentials are used only to establish a secure connection and are not stored.
                    </p>
                </div>
            </div>
        </div>
    );

    return (
        <Show
            when={isAuthenticated()}
            fallback={<LoginScreen />}
        >
            <div class="dashboard">
                {/* Header */}
                <header class="dashboard-header">
                    <div class="header-container">
                        <div class="header-left">
                            <h1 class="dashboard-title">Watch List</h1>
                            <p class="dashboard-subtitle">Track your favorite movies and TV shows</p>
                        </div>
                        <div class="header-right">
                            <div class="stats-container">
                                <div class="stat-item">
                                    <span class="stat-value">{watchList().length}</span>
                                    <span class="stat-label">Total</span>
                                </div>
                                <div class="stat-divider" />
                                <div class="stat-item">
                                    <span class="stat-value">{watchList().filter(item => item.media_type === 'movie').length}</span>
                                    <span class="stat-label">Movies</span>
                                </div>
                                <div class="stat-divider" />
                                <div class="stat-item">
                                    <span class="stat-value">{watchList().filter(item => item.media_type === 'tv').length}</span>
                                    <span class="stat-label">TV Shows</span>
                                </div>
                                <div class="stat-divider" />
                                <div class="stat-item">
                                    <span class="stat-value">{selectedIds().length}</span>
                                    <span class="stat-label">Selected</span>
                                </div>
                                <Button
                                    onClick={toggleDeveloperMode}
                                    variant="outline"
                                    size="sm"
                                    class="action-btn"
                                    disabled={loading()}
                                >
                                    {developerMode() ? 'Dev Mode' : 'User Mode'}
                                </Button>
                                <Button
                                    onClick={handleLogout}
                                    variant="outline"
                                    size="sm"
                                    class="action-btn logout-btn"
                                    disabled={loading()}
                                >
                                    Logout
                                </Button>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Developer Controls */}
                <Show when={developerMode()}>
                    <div class="developer-panel">
                        <div class="developer-controls">
                            <div class="control-group">
                                <p>Toggle validation modes to test security measures</p>
                            </div>
                            <div class="validation-toggle">
                                <label class="toggle-container">
                                    <Checkbox
                                        checked={clientValidationEnabled()}
                                        onChange={toggleValidationMode}
                                        class="flex items-center space-x-3"
                                    >
                                        <CheckboxControl />
                                    </Checkbox>
                                    <div class="toggle-info">
                                        <span class="toggle-label">
                                            {clientValidationEnabled() ? 'Client Validation Enabled' : 'Backend-Only Validation'}
                                        </span>
                                        <span class="toggle-description">
                                            {clientValidationEnabled()
                                                ? 'Front-end validation is ENABLED, SolidJS will handle raw form inputs!'
                                                : 'Front-end validation is DISABLED, Tauri will handle raw form inputs!'
                                            }
                                        </span>
                                    </div>
                                </label>
                            </div>
                            <div class="validation-status">
                                <div class={`status-indicator ${clientValidationEnabled() ? 'secure' : 'testing'}`}>
                                    {clientValidationEnabled() ? 'SolidJS' : 'Tauri'}
                                </div>
                            </div>
                        </div>
                    </div>
                </Show>

                {/* Main Content */}
                <main class="dashboard-main">

                    {/* Warning when validation is disabled */}
                    <Show when={!clientValidationEnabled()}>
                        <div class="validation-warning">
                            <div class="warning-content justify-center items-center">
                                <h3>Client Validation Disabled</h3>
                            </div>
                        </div>
                    </Show>

                    <div class="dashboard-grid">
                        {/* Add Item Panel */}
                        <div class="panel add-panel">
                            <div class="panel-header">
                                <h2 class="panel-title">Add to Watch List</h2>
                                <div>
                                    <p class="panel-description">
                                        Add a new movie or TV show
                                    </p>
                                    {!clientValidationEnabled() && <span class="testing-indicator"> (Testing Mode)</span>}
                                </div>
                            </div>

                            <div class="panel-content">
                                <form class="watch-form" onSubmit={(e) => { e.preventDefault(); insertWatchItem(); }}>
                                    {/* Media Type Radio Buttons */}
                                    <div class="form-group">
                                        <label class="form-label">Type</label>
                                        <div class="radio-group">
                                            <label class="radio-option">
                                                <input
                                                    type="radio"
                                                    name="media_type"
                                                    value="movie"
                                                    checked={formData().media_type === 'movie'}
                                                    onChange={() => setFormData(prev => ({ ...prev, media_type: 'movie' }))}
                                                />
                                                <span class="radio-custom"></span>
                                                <span class="radio-label">🎬 Movie</span>
                                            </label>
                                            <label class="radio-option">
                                                <input
                                                    type="radio"
                                                    name="media_type"
                                                    value="tv"
                                                    checked={formData().media_type === 'tv'}
                                                    onChange={() => setFormData(prev => ({ ...prev, media_type: 'tv' }))}
                                                />
                                                <span class="radio-custom"></span>
                                                <span class="radio-label">📺 TV Show</span>
                                            </label>
                                        </div>
                                    </div>

                                    <div class="form-group">
                                        <TextFieldRoot>
                                            <TextFieldLabel class="form-label">
                                                Name
                                            </TextFieldLabel>
                                            <TextField
                                                class="form-input"
                                                value={formData().name}
                                                onInput={(e) => handleNameInput(e.currentTarget.value)}
                                                placeholder="Enter movie or TV show name..."
                                                maxlength={clientValidationEnabled() ? MAX_NAME_LENGTH : undefined}
                                                required={clientValidationEnabled()}
                                            />
                                        </TextFieldRoot>
                                        <div class="justify-end flex flex-1">
                                            {clientValidationEnabled() && (
                                                <Badge variant="outline" class="text-[var(--text-placeholder)]">({formData().name.length}/{MAX_NAME_LENGTH})</Badge>
                                            )}
                                        </div>
                                    </div>

                                    <div class="form-row">
                                        <div class="form-group rating-group">
                                            <TextFieldRoot>
                                                <TextFieldLabel class="form-label">Rating</TextFieldLabel>
                                                <TextField
                                                    type="number"
                                                    class="form-input rating-input"
                                                    value={formData().rating.toString()}
                                                    onInput={(e) => handleRatingInput(e.currentTarget.value)}
                                                    min={clientValidationEnabled() ? MIN_RATING : undefined}
                                                    max={clientValidationEnabled() ? MAX_RATING : undefined}
                                                    step="1"
                                                />
                                            </TextFieldRoot>
                                            <div class="rating-indicator">
                                                <div class={`rating-level ${getRatingColor(formData().rating)}`}>
                                                    {getRatingLabel(formData().rating)} ({formData().rating}/10)
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="checkbox-group">
                                        <label class="checkbox-container">
                                            <Checkbox
                                                checked={formData().would_watch_again}
                                                onChange={(checked) => setFormData(prev => ({ ...prev, would_watch_again: checked }))}
                                                class="flex items-center space-x-2"
                                            >
                                                <CheckboxControl />
                                            </Checkbox>
                                            <span class="checkbox-label">Would watch again</span>
                                        </label>
                                    </div>

                                    <Button
                                        type="submit"
                                        disabled={loading() || (clientValidationEnabled() && (!formData().name.trim() || validationErrors().length > 0))}
                                        class="submit-btn"
                                    >
                                        {loading() ? 'Adding...' : 'Add'}
                                    </Button>
                                </form>
                            </div>
                        </div>

                        {/* Watch List Panel */}
                        <div class="panel watch-list-panel">
                            <div class="panel-header">
                                <div class="panel-header-left">
                                    <h2 class="panel-title">Your Watch List</h2>
                                    <p class="panel-description">{watchList().length} total items</p>
                                </div>
                                <div class="panel-actions">
                                    <Button
                                        onClick={selectAll}
                                        variant="outline"
                                        size="sm"
                                        class="action-btn"
                                        disabled={watchList().length === 0}
                                    >
                                        {selectedIds().length === watchList().length ? 'Deselect All' : 'Select All'}
                                    </Button>
                                    <Show when={selectedIds().length > 0}>
                                        <Button
                                            onClick={deleteSelectedItems}
                                            disabled={loading() || (clientValidationEnabled() && selectedIds().length > MAX_BATCH_DELETE_SIZE)}
                                            variant="destructive"
                                            size="sm"
                                            class="action-btn delete-btn"
                                        >
                                            {loading() ? 'Deleting...' : `Delete (${selectedIds().length})`}
                                        </Button>
                                    </Show>
                                    <Button
                                        onClick={loadWatchList}
                                        variant="outline"
                                        size="sm"
                                        class="action-btn"
                                        disabled={loading()}
                                    >
                                        Refresh
                                    </Button>
                                </div>
                            </div>

                            <div class="panel-content">
                                <Show
                                    when={watchList().length > 0}
                                    fallback={
                                        <div class="empty-state">
                                            <div class="empty-icon">🎬</div>
                                            <h3 class="empty-title">No items in watch list</h3>
                                            <p class="empty-description">Add your first movie or TV show to get started</p>
                                        </div>
                                    }
                                >
                                    <div class="watch-list">
                                        <For each={watchList()}>
                                            {(item) => (
                                                <div
                                                    class={`watch-item ${selectedIds().includes(item.id!) ? 'selected' : ''}`}
                                                    onClick={() => item.id && toggleSelection(item.id)}
                                                >
                                                    <div class="watch-checkbox">
                                                        <Checkbox
                                                            checked={item.id ? selectedIds().includes(item.id) : false}
                                                            onChange={(checked) => {
                                                                if (item.id) {
                                                                    if (checked) {
                                                                        setSelectedIds(prev => [...prev, item.id!]);
                                                                    } else {
                                                                        setSelectedIds(prev => prev.filter(id => id !== item.id!));
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                    </div>

                                                    <div class="watch-content">
                                                        <div class="watch-header">
                                                            <div class="watch-title">
                                                                <span class="media-icon">{getMediaTypeIcon(item.media_type)}</span>
                                                                <h3 class="watch-name" innerHTML={item.name}></h3>
                                                            </div>
                                                            <div class="watch-badges">
                                                                <Badge class="id-badge">#{item.id}</Badge>
                                                                <Badge class="media-type-badge">{getMediaTypeLabel(item.media_type)}</Badge>
                                                                <Badge variant="outline" class={`rating-badge ${getRatingColor(item.rating)}`}>
                                                                    {item.rating}/10
                                                                </Badge>
                                                                <Show when={item.would_watch_again}>
                                                                    <Badge class="rewatch-badge">Would Rewatch</Badge>
                                                                </Show>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </For>
                                    </div>
                                </Show>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </Show>
    );
};

export default App;