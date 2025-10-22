import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  email: string = '';
  password: string = '';
  authKey: string = '';
  isLoading: boolean = false;
  isKeyLoading: boolean = false;
  errorMessage: string = '';
  keyErrorMessage: string = '';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  async onKeySubmit() {
    if (!this.authKey) {
      this.keyErrorMessage = 'Vui lòng nhập key';
      return;
    }

    this.isKeyLoading = true;
    this.keyErrorMessage = '';

    try {
      const success = await this.authService.signInWithKey(this.authKey);
      if (success) {
        this.router.navigate(['/dashboard']);
      } else {
        this.keyErrorMessage = 'Key không đúng. Vui lòng nhập "CLICKMETER"';
      }
    } catch (error: any) {
      this.keyErrorMessage = error.message || 'Đăng nhập thất bại';
    } finally {
      this.isKeyLoading = false;
    }
  }

  async onSubmit() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Vui lòng nhập đầy đủ email và mật khẩu';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      await this.authService.signIn(this.email, this.password);
      this.router.navigate(['/dashboard']);
    } catch (error: any) {
      this.errorMessage = error.message || 'Đăng nhập thất bại';
    } finally {
      this.isLoading = false;
    }
  }
}