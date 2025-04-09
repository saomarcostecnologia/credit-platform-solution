export class CreditData {
    constructor(
      public readonly customerId: string,
      public readonly creditScore: number,
      public readonly monthlyIncome: number,
      public readonly existingDebts: number,
      public readonly createdAt: Date
    ) {}
    
    public calculateDebtToIncomeRatio(): number {
      return this.existingDebts / this.monthlyIncome;
    }
    
    public isCreditWorthy(limitAmount: number): boolean {
      const dti = this.calculateDebtToIncomeRatio();
      
      if (this.creditScore < 500) return false;
      if (dti > 0.5) return false;
      if (limitAmount > this.monthlyIncome * 12) return false;
      
      return true;
    }
    
    public toJSON(): any {
      return {
        customerId: this.customerId,
        creditScore: this.creditScore,
        monthlyIncome: this.monthlyIncome,
        existingDebts: this.existingDebts,
        createdAt: this.createdAt.toISOString(),
        debtToIncomeRatio: this.calculateDebtToIncomeRatio()
      };
    }
  }