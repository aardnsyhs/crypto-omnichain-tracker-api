import { IsNotEmpty, IsString, Matches, IsIn } from 'class-validator';

export class TransactionLookupDto {
  @IsNotEmpty({ message: 'chain is required' })
  @IsString()
  @IsIn(['ethereum', 'bsc', 'polygon'], {
    message: 'chain must be one of: ethereum, bsc, polygon',
  })
  chain!: 'ethereum' | 'bsc' | 'polygon';

  @IsNotEmpty({ message: 'transactionHash is required' })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{64}$/, {
    message: 'transactionHash must match 0x followed by 64 hexadecimal characters',
  })
  transactionHash!: string;
}
