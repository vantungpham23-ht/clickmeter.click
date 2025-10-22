import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../environments/environment';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase: SupabaseClient | null = null;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  
  // Simple key-based authentication
  private readonly SIMPLE_AUTH_KEY = 'CLICKMETER';
  private isSimpleAuthEnabled = new BehaviorSubject<boolean>(false);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      this.supabase = createClient(environment.supabase.url, environment.supabase.anonKey);
      this.initializeAuth();
      
      // Check for simple auth on initialization
      this.checkSimpleAuth();
    }
  }

  private async initializeAuth() {
    if (!this.supabase) return;
    
    // Check for existing session
    const { data: { session } } = await this.supabase.auth.getSession();
    this.currentUserSubject.next(session?.user ?? null);

    // Listen for auth changes
    this.supabase.auth.onAuthStateChange((event, session) => {
      this.currentUserSubject.next(session?.user ?? null);
    });
  }

  // Simple key-based authentication
  async signInWithKey(key: string): Promise<boolean> {
    if (key === this.SIMPLE_AUTH_KEY) {
      // Create a mock user for simple auth
      const mockUser = {
        id: 'simple-auth-user',
        email: 'user@clickmeter.com',
        user_metadata: {},
        app_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as User;
      
      this.currentUserSubject.next(mockUser);
      this.isSimpleAuthEnabled.next(true);
      
      // Store in localStorage for persistence
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('simple-auth', 'true');
        localStorage.setItem('auth-key', key);
      }
      
      return true;
    }
    return false;
  }

  // Check if simple auth is active
  checkSimpleAuth(): boolean {
    if (typeof localStorage !== 'undefined') {
      const isSimpleAuth = localStorage.getItem('simple-auth') === 'true';
      const storedKey = localStorage.getItem('auth-key');
      
      if (isSimpleAuth && storedKey === this.SIMPLE_AUTH_KEY) {
        // Restore mock user
        const mockUser = {
          id: 'simple-auth-user',
          email: 'user@clickmeter.com',
          user_metadata: {},
          app_metadata: {},
          aud: 'authenticated',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as User;
        
        this.currentUserSubject.next(mockUser);
        this.isSimpleAuthEnabled.next(true);
        return true;
      }
    }
    return false;
  }

  async signIn(email: string, password: string) {
    if (!this.supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      throw error;
    }
    
    return data;
  }

  async signUp(email: string, password: string) {
    if (!this.supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password
    });
    
    if (error) {
      throw error;
    }
    
    return data;
  }

  async signOut() {
    // Clear simple auth
    this.isSimpleAuthEnabled.next(false);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('simple-auth');
      localStorage.removeItem('auth-key');
    }
    
    // Clear Supabase auth if exists
    if (this.supabase) {
      const { error } = await this.supabase.auth.signOut();
      if (error) {
        throw error;
      }
    }
    
    this.currentUserSubject.next(null);
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  isAuthenticated(): boolean {
    return this.getCurrentUser() !== null;
  }
}