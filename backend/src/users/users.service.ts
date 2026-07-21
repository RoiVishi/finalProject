import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  async create(data: Pick<User, 'email' | 'passwordHash' | 'fullName'>) {
    if (await this.repo.findOneBy({ email: data.email })) {
      throw new ConflictException('Email already registered');
    }
    return this.repo.save(this.repo.create(data));
  }

  findByEmailWithPassword(email: string) {
    return this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();
  }

  findById(id: string) {
    return this.repo.findOneBy({ id });
  }
}
