import {
  IsNotEmpty,
  IsString,
  IsIn,
  IsOptional,
  IsBoolean,
  ValidateBy,
  ValidationArguments,
  ValidationOptions,
  buildMessage,
} from 'class-validator';
import {
  ALL_SUPPORTED_CHAINS,
  type SupportedChain,
  isValidHashForChain,
  isUtxoChain,
} from '../../common/constants/network-registry';

export function IsValidTransactionHash(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isValidTransactionHash',
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          const obj = args.object as { chain?: string };
          const chain = obj.chain;
          if (!chain) return false;
          return isValidHashForChain(chain, value);
        },
        defaultMessage: buildMessage(
          (eachPrefix, args) => {
            const obj = args?.object as { chain?: string };
            const chain = obj?.chain;
            if (chain && isUtxoChain(chain)) {
              return `transactionHash for ${chain} must be a 64-character hexadecimal transaction ID without 0x prefix`;
            }
            return `transactionHash must match 0x followed by 64 hexadecimal characters`;
          },
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

export class TransactionLookupDto {
  @IsNotEmpty({ message: 'chain is required' })
  @IsString()
  @IsIn(ALL_SUPPORTED_CHAINS as unknown as string[], {
    message: `chain must be one of: ${ALL_SUPPORTED_CHAINS.join(', ')}`,
  })
  chain!: SupportedChain;

  @IsNotEmpty({ message: 'transactionHash is required' })
  @IsString()
  @IsValidTransactionHash()
  transactionHash!: string;

  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}
