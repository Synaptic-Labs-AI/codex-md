<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import Button from './Button.svelte';
  import Container from './Container.svelte';
  import { paymentService } from '../../services/payment';
  import { paymentStore } from '../../stores/payment';

  const dispatch = createEventDispatcher();

  export let showPayment = false;
  let className = '';
  export { className as class };

  let customAmount = '';
  let selectedAmount = null;
  let isProcessing = false;
  let error = null;
  let cardElement;
  
  const presetAmounts = [
    { value: 5, label: '5 Copper 🥉' },
    { value: 10, label: '10 Silver 🥈' },
    { value: 20, label: '20 Gold 🥇' }
  ];

  let initializationError = false;

  onMount(async () => {
    if (showPayment) {
      try {
        await paymentService.init();
        
        cardElement = paymentService.createCardElement();
        cardElement.mount('#card-element');
        cardElement.on('change', handleCardChange);
        
        error = null;
        initializationError = false;
      } catch (err) {
        console.error('Failed to initialize payment:', err);
        error = 'Payment system initialization failed. Please try again later.';
        initializationError = true;
      }
    }
  });

  onDestroy(() => {
    if (cardElement) {
      cardElement.destroy();
    }
  });

  function handleCardChange(event) {
    if (event.error) {
      error = event.error.message;
    } else {
      error = null;
    }
  }

  function handleAmountSelect(amount) {
    selectedAmount = amount;
    customAmount = amount.toString();
    error = null;
  }

  function handleCustomAmountInput(event) {
    customAmount = event.target.value;
    selectedAmount = parseFloat(customAmount);
    error = null;
  }

  async function handleContinue() {
    const amount = parseFloat(customAmount) || 0;
    
    if (!amount || amount <= 0) {
      error = 'Please enter a valid amount';
      return;
    }

    if (!cardElement) {
      error = 'Payment form not initialized';
      return;
    }

    isProcessing = true;
    error = null;

    try {
      // 1. Get client secret from backend
      const clientSecret = await paymentService.initiatePayment(amount);
      
      // 2. Confirm the payment with Stripe
      await paymentService.confirmPayment(clientSecret);
      
      // 3. Handle success
      dispatch('payment', { amount });
    } catch (err) {
      error = err.message || 'Payment failed. Please try again.';
      console.error('Payment error:', err);
    } finally {
      isProcessing = false;
    }
  }

  function handleSkip() {
    dispatch('skip');
  }
</script>

{#if showPayment}
  <Container class={className}>
    <div class="payment-content" in:fly={{ y: 20, duration: 400 }}>
      <!-- Professor's Message -->
      <div class="professor-message">
        <h2>🧙🏾‍♂️ Welcome to the Markdown Transformation Engine!</h2>
        
        <div class="feature-list">
          <p>Transform your content into Obsidian-optimized Markdown to:</p>
          <ul>
            <li>✨ Build your Second Brain</li>
            <li>✨ Ensure data sovereignty</li>
            <li>✨ Make knowledge management effortless</li>
          </ul>
        </div>
        
        <p>Our arcane algorithms are free to use, but we welcome your support in maintaining the ethereal servers.</p>
        
        <div class="signature">
          ~ Professor Synapse<br>
        </div>
      </div>

      <!-- Payment Options -->
      <div class="payment-options">
        <div class="preset-amounts">
          {#each presetAmounts as amount}
            <button
              class="amount-button {selectedAmount === amount.value ? 'selected' : ''}"
              on:click={() => handleAmountSelect(amount.value)}
            >
              {amount.label}
            </button>
          {/each}
        </div>

        <div class="input-row">
          <div class="custom-amount">
            <label for="custom-amount">Custom Amount</label>
            <div class="input-wrapper">
              <span class="currency-symbol">$</span>
              <input
                id="custom-amount"
                type="number"
                min="0"
                step="0.01"
                bind:value={customAmount}
                on:input={handleCustomAmountInput}
                placeholder="Enter amount"
              />
            </div>
          </div>
        </div>

        <!-- Stripe Card Element -->
        <div class="card-element-container">
          <div id="card-element"></div>
          {#if error}
            <div class="error-message" in:fade>{error}</div>
          {/if}
        </div>

        <div class="support-button">
          <Button 
            on:click={handleContinue} 
            disabled={isProcessing || initializationError || !cardElement}
          >
            {#if isProcessing}
              Processing...
            {:else}
              {customAmount ? `Support ($${customAmount})` : 'Support the Magic'}
            {/if}
          </Button>
        </div>

        <button class="skip-button" on:click={handleSkip}>
          I do not wish to support the magical arts at this time...
        </button>
      </div>
    </div>
  </Container>
{/if}

<style>
  .payment-content {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    height: auto;
    min-height: min-content;
    position: relative;
  }

  .card-element-container {
    margin: 1rem 0;
    padding: 1rem;
    border-radius: var(--rounded-lg);
    background: transparent;
    position: relative;
  }

  .card-element-container::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--rounded-lg);
    padding: 2px;
    background: linear-gradient(135deg, var(--color-prime), var(--color-second));
    -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  .card-element-container:has(#card-element:not(:empty)) {
    min-height: 100px;
  }

  #card-element {
    padding: 0.5rem;
    position: relative;
    z-index: 1;
  }

  .error-message {
    color: var(--color-error);
    font-size: 0.9rem;
    margin-top: 0.5rem;
    padding: 0.5rem;
    border-radius: var(--rounded-md);
    position: relative;
    background: transparent;
  }

  .error-message::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--rounded-md);
    padding: 2px;
    background: linear-gradient(135deg, var(--color-error), var(--color-error-light));
    -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  .professor-message {
    position: relative;
    padding: 1rem;
    background: transparent;
    border-radius: var(--rounded-lg);
    margin-bottom: 1rem;
  }

  .professor-message::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--rounded-lg);
    padding: 2px;
    background: linear-gradient(135deg, var(--color-prime), var(--color-second));
    -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  h2 {
    font-size: 1.25rem;
    margin-bottom: 0.75rem;
    text-align: center;
    color: var(--color-text);
    position: relative;
    z-index: 1;
  }

  .feature-list {
    margin: 1rem 0;
    padding: 0.75rem;
    background: transparent;
    border-radius: var(--rounded-lg);
    position: relative;
    z-index: 1;
  }

  .feature-list ul {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0 0;
  }

  .feature-list li {
    margin: 0.4rem 0;
    padding-left: 1rem;
    color: var(--color-text);
  }

  p {
    margin-bottom: 0.75rem;
    line-height: 1.4;
    color: var(--color-text);
    position: relative;
    z-index: 1;
  }

  .signature {
    font-style: italic;
    margin-top: 0.75rem;
    padding-left: 1rem;
    opacity: 0.8;
    font-size: 0.9rem;
    color: var(--color-text);
    position: relative;
    z-index: 1;
  }

  .payment-options {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .preset-amounts {
    display: flex;
    gap: 0.5rem;
  }

  .amount-button {
    flex: 1;
    padding: 0.5rem;
    background: transparent;
    border-radius: var(--rounded-md);
    cursor: pointer;
    transition: all 0.3s ease;
    font-size: 0.9rem;
    position: relative;
    color: var(--color-text);
  }

  .amount-button::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--rounded-md);
    padding: 2px;
    background: linear-gradient(135deg, var(--color-prime), var(--color-second));
    -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  .amount-button:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-sm);
  }

  .amount-button.selected::before {
    background: linear-gradient(135deg, var(--color-second), var(--color-prime));
  }

  .input-row {
    display: flex;
    gap: 1rem;
    align-items: flex-end;
  }

  .custom-amount {
    flex: 1;
  }

  .input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .currency-symbol {
    position: absolute;
    left: 0.75rem;
    color: var(--color-text);
    z-index: 2;
  }

  input {
    width: 100%;
    padding: 0.5rem;
    padding-left: 1.5rem;
    background: transparent;
    border-radius: var(--rounded-md);
    font-size: 0.9rem;
    color: var(--color-text);
    position: relative;
  }

  .input-wrapper::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--rounded-md);
    padding: 2px;
    background: linear-gradient(135deg, var(--color-prime), var(--color-second));
    -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  input:focus {
    outline: none;
  }

  .support-button {
    min-width: 140px;
  }

  .support-button :global(button) {
    width: 100%;
  }

  .skip-button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.8rem;
    font-style: italic;
    text-decoration: underline;
    padding: 0.25rem;
    transition: opacity 0.3s ease;
    opacity: 0.7;
    margin: 0 auto;
    color: var(--color-text);
  }

  .skip-button:hover {
    opacity: 1;
  }

  @media (max-width: 640px) {
    .preset-amounts {
      flex-direction: column;
    }

    .input-row {
      flex-direction: column;
      gap: 0.75rem;
    }

    .support-button {
      width: 100%;
      min-width: unset;
    }
  }
</style>
