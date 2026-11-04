import { useState } from "react";
import {
  ArrowUpRightIcon,
  ArrowLeftIcon,
  MinusIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { rupees } from "./collection";
import type { CartLine } from "./collection";

type CartProps = {
  lines: CartLine[];
  change: (key: string, quantity: number) => void;
};
export function Bag({ lines, change }: CartProps) {
  return (
    <main className="page wrap narrow" id="main">
      <div className="page-heading">
        <h1>Your bag</h1>
        <a href="/shop" className="inline-link">
          Continue shopping
        </a>
      </div>
      {!lines.length ? (
        <div className="empty">
          <p>Your bag is empty.</p>
          <a className="primary" href="/shop">
            Explore the shop <ArrowUpRightIcon />
          </a>
        </div>
      ) : (
        <>
          <div className="bag-lines">
            {lines.map((l) => (
              <div className="bag-line" key={l.key}>
                {l.image ? (
                  <img src={l.image} alt="" />
                ) : (
                  <div className="file-thumb">3D</div>
                )}
                <div>
                  <h2>{l.title}</h2>
                  <p>{l.detail}</p>
                  {l.physical && (
                    <div className="qty-controls">
                      <button
                        aria-label={"Decrease quantity of " + l.title}
                        disabled={l.quantity <= 1}
                        onClick={() => change(l.key, l.quantity - 1)}
                      >
                        <MinusIcon />
                      </button>
                      <span>{l.quantity}</span>
                      <button
                        aria-label={"Increase quantity of " + l.title}
                        disabled={l.quantity >= 100000}
                        onClick={() => change(l.key, l.quantity + 1)}
                      >
                        <PlusIcon />
                      </button>
                    </div>
                  )}
                </div>
                <div className="bag-money">
                  <strong>{rupees(l.price * l.quantity)}</strong>
                  <button
                    aria-label={"Remove " + l.title}
                    onClick={() => change(l.key, 0)}
                  >
                    <XIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="total">
            <span>Preview subtotal</span>
            <strong>
              {rupees(lines.reduce((s, l) => s + l.price * l.quantity, 0))}
            </strong>
          </div>
          <a className="primary" href="/checkout">
            Review checkout <ArrowUpRightIcon />
          </a>
        </>
      )}
    </main>
  );
}

export function Checkout({
  lines,
  complete,
}: {
  lines: CartLine[];
  complete: () => void;
}) {
  const [receipt, setReceipt] = useState(false);
  const physical = lines.some((l) => l.physical);
  if (receipt)
    return (
      <main id="main" className="page wrap narrow">
        <h1>Checkout preview complete.</h1>
        <p className="lead">
          Your sample order reached the confirmation step. No payment was
          collected and no files were delivered.
        </p>
        <a className="inline-link" href="/shop">
          Back to shop
        </a>
      </main>
    );
  if (!lines.length)
    return (
      <main id="main" className="page wrap">
        <h1>Your bag is empty.</h1>
        <a href="/shop">Visit the shop</a>
      </main>
    );
  return (
    <main className="page wrap" id="main">
      <a className="back" href="/bag">
        <ArrowLeftIcon />
        Bag
      </a>
      <div className="page-heading">
        <h1>Checkout</h1>
        <p>Design preview. Use sample details to try this flow.</p>
      </div>
      <div className="checkout-grid">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            setReceipt(true);
            complete();
          }}
        >
          <h2>{physical ? "Delivery details" : "Digital delivery"}</h2>
          <label>
            Name
            <input required name="name" autoComplete="name" maxLength={100} />
          </label>
          <label>
            Email
            <input required type="email" name="email" autoComplete="email" />
          </label>
          {physical && (
            <>
              <label>
                Delivery address
                <textarea
                  required
                  name="address"
                  autoComplete="street-address"
                  rows={2}
                />
              </label>
              <div className="form-pair">
                <label>
                  City
                  <input required autoComplete="address-level2" />
                </label>
                <label>
                  PIN code
                  <input
                    required
                    pattern="[0-9]{6}"
                    inputMode="numeric"
                    autoComplete="postal-code"
                  />
                </label>
              </div>
            </>
          )}
          <button className="primary">
            Complete preview order <ArrowUpRightIcon />
          </button>
        </form>
        <aside className="summary">
          <h2>Order summary</h2>
          {lines.map((l) => (
            <div key={l.key}>
              <span>
                {l.title} × {l.quantity}
                <small>{l.detail}</small>
              </span>
              <b>{rupees(l.price * l.quantity)}</b>
            </div>
          ))}
          <div>
            <strong>Sample total</strong>
            <strong>
              {rupees(lines.reduce((s, l) => s + l.price * l.quantity, 0))}
            </strong>
          </div>
          <p>
            This checkout uses sample prices. Completing it does not collect payment or place a production order.
          </p>
        </aside>
      </div>
    </main>
  );
}
