import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import type { UserProfile } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto): Promise<{ authToken: string; refreshToken: string }> {
    return this.authService.login(body);
  }

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(
    @Body() body: SignupDto,
  ): Promise<{ authToken: string; refreshToken: string; browse: boolean }> {
    return this.authService.signup(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: RefreshTokenDto,
  ): Promise<{ authToken: string; refreshToken: string }> {
    return this.authService.refresh(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: User): Promise<UserProfile> {
    return this.authService.me(user.id);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(): Promise<{ success: true }> {
    // Stateless JWT — nothing to revoke server-side; the client discards the token.
    return { success: true };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: ResetPasswordDto): Promise<{ success: true }> {
    return this.authService.sendResetPasswordEmail(body);
  }

  @Post('update-password')
  @HttpCode(HttpStatus.OK)
  async updatePassword(@Body() body: UpdatePasswordDto): Promise<{ success: true }> {
    return this.authService.updatePassword(body);
  }
}
