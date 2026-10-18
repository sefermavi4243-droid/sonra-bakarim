/**
 * Bellek içi kuyruk: aynı kullanıcının mesajları sırayla, farklı kullanıcılarınki
 * paralel işlenir. Kalıcılık `inbound_messages.processed_at` ile sağlanır; süreç
 * yeniden başlarsa işlenmemiş mesajlar `recover` ile tekrar kuyruğa girer.
 */
export class PerUserQueue {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly onError: (err: unknown) => void = () => undefined) {}

  push(userId: string, job: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(userId) ?? Promise.resolve();
    const next = prev.then(job).catch(this.onError);
    this.tails.set(userId, next);
    void next.then(() => {
      if (this.tails.get(userId) === next) this.tails.delete(userId);
    });
    return next;
  }

  async idle(): Promise<void> {
    while (this.tails.size) await Promise.all(this.tails.values());
  }
}
