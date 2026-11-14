const password = document.getElementById("registration-password");
const passwordConfirm = document.getElementById("registration-password-confirm");

document.querySelectorAll("[data-digits-only]").forEach((input) => {
  input.addEventListener("input", () => {
    const maxDigits = Number(input.dataset.maxDigits);
    input.value = input.value.replace(/\D/g, "").slice(0, maxDigits);
    const exactDigits = Number(input.dataset.exactDigits);
    input.setCustomValidity(
      input.value.length > 0 && input.value.length !== exactDigits
        ? `Введите ровно ${exactDigits} цифр`
        : "",
    );
  });
});

document.querySelectorAll("[data-phone-format]").forEach((phoneInput) => {
  phoneInput.addEventListener("input", () => {
    const caret = phoneInput.selectionStart;
    const digitsBeforeCaret = phoneInput.value.slice(0, caret).replace(/\D/g, "").length;
    const digits = phoneInput.value.replace(/\D/g, "").slice(0, 9);
    phoneInput.value = digits.replace(/(\d{3})(?=\d)/g, "$1 ");
    const formattedCaret = phoneInput.value
      .split("")
      .reduce((position, character, index) => {
        if (/\d/.test(character) && position.digits < digitsBeforeCaret) {
          return { digits: position.digits + 1, index: index + 1 };
        }
        return position;
      }, { digits: 0, index: 0 }).index;
    phoneInput.setSelectionRange(formattedCaret, formattedCaret);
    phoneInput.setCustomValidity(
      digits.length > 0 && digits.length !== 9 ? "Введите ровно 9 цифр" : "",
    );
  });

  phoneInput.addEventListener("blur", () => {
    if (phoneInput.value) {
      phoneInput.value = phoneInput.value.replace(/\D/g, "").replace(/(\d{3})(?=\d)/g, "$1 ");
    }
  });
});

document.querySelector(".registration-form .eye-btn").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const isVisible = password.type === "text";
  [password, passwordConfirm].forEach((input) => {
    input.type = isVisible ? "password" : "text";
  });
  button.setAttribute("aria-pressed", String(!isVisible));
  button.setAttribute("aria-label", isVisible ? "Показать оба пароля" : "Скрыть оба пароля");
  button.classList.toggle("is-visible", !isVisible);
});

const form = document.querySelector(".registration-form");
const loginPanel = document.querySelector(".login-panel");
const homeScreen = document.querySelector(".home-screen");
const resetPasswordPanel = document.querySelector(".reset-password-panel");
const verificationPanel = document.querySelector(".verification-panel");
const newPasswordPanel = document.querySelector(".new-password-panel");
const authFlowPanels = [resetPasswordPanel, verificationPanel, newPasswordPanel];
const authForms = [form, loginPanel, ...authFlowPanels];
const recoveryPhoneInput = resetPasswordPanel.querySelector("[data-phone-format]");
const recoveryPassword = document.getElementById("recovery-password");
const recoveryPasswordConfirm = document.getElementById("recovery-password-confirm");
const codeInputs = [...verificationPanel.querySelectorAll(".code-digit")];
const formStatus = document.querySelector(".form-status");
const pageTitle = document.getElementById("page-title");
const welcomeMessage = document.getElementById("welcome-message");
const setFormStatus = (message, type = "info") => {
  formStatus.textContent = message;
  formStatus.classList.toggle("is-error", type === "error");
  formStatus.classList.toggle("is-info", type === "info");
  formStatus.setAttribute("role", type === "error" ? "alert" : "status");
  formStatus.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
};
const clearFormStatus = () => {
  setFormStatus("");
};
const clearFormValidation = (currentForm) => {
  currentForm.classList.remove("was-validated");
  currentForm.querySelectorAll("input[aria-invalid]").forEach((input) => {
    input.removeAttribute("aria-invalid");
  });
};
const shopName = form.querySelector('[placeholder="Название магазина"]');
const address = form.querySelector('[placeholder="Адрес магазина / доставки"]');
const accountType = form.querySelector('[name="accountType"]');
const agreementCheckbox = form.querySelector('.checkbox-row input[type="checkbox"]');
const agreementSheet = document.getElementById("agreement-sheet");
const agreementContent = document.getElementById("agreement-content");
const agreementTabs = [...document.querySelectorAll(".agreement-tab")];
const agreementAcceptButton = document.querySelector(".agreement-accept");
const agreementNote = document.querySelector(".agreement-note");
const agreementCloseButton = document.querySelector(".agreement-close");
const agreementDocuments = {
  terms: "Documents/user_agreement_zakup_kg.md",
  offer: "Documents/oferta.md",
  privacy: "Documents/privacy.md",
};
let agreementReturnFocus = null;
let agreementLoadId = 0;

const appendInlineMarkdown = (container, text) => {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  parts.forEach((part) => {
    if (!part) {
      return;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      container.append(strong);
    } else if (part.startsWith("*") && part.endsWith("*")) {
      const emphasis = document.createElement("em");
      emphasis.textContent = part.slice(1, -1);
      container.append(emphasis);
    } else if (part.startsWith("`") && part.endsWith("`")) {
      const code = document.createElement("code");
      code.textContent = part.slice(1, -1);
      container.append(code);
    } else {
      container.append(document.createTextNode(part));
    }
  });
};

const renderMarkdown = (markdown) => {
  const fragment = document.createDocumentFragment();
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const isHeading = (line) => /^\s{0,3}#{1,6}\s+/.test(line);
  const listType = (line) => {
    if (/^\s*[-*+]\s+/.test(line)) {
      return "ul";
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      return "ol";
    }
    return null;
  };
  let previousBlockWasDocumentTitle = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInlineMarkdown(element, heading[2]);
      fragment.append(element);
      previousBlockWasDocumentTitle = heading[1].length === 1;
      index += 1;
      continue;
    }

    const type = listType(line);
    if (type) {
      const list = document.createElement(type);
      while (index < lines.length && listType(lines[index]) === type) {
        const item = lines[index].replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
        const listItem = document.createElement("li");
        appendInlineMarkdown(listItem, item);
        list.append(listItem);
        index += 1;
      }
      fragment.append(list);
      previousBlockWasDocumentTitle = false;
      continue;
    }

    const paragraphLines = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isHeading(lines[index]) &&
      !listType(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement("p");
    const isDocumentSubtitle =
      previousBlockWasDocumentTitle &&
      paragraphLines.length === 1 &&
      /^\s*\*\*.+\*\*\s*$/.test(paragraphLines[0]);
    if (isDocumentSubtitle) {
      paragraph.classList.add("agreement-subtitle");
    }
    paragraphLines.forEach((paragraphLine, lineIndex) => {
      const hardBreak = / {2,}$/.test(paragraphLine);
      appendInlineMarkdown(paragraph, paragraphLine.replace(/ {2,}$/, ""));
      if (lineIndex < paragraphLines.length - 1) {
        paragraph.append(
          hardBreak ? document.createElement("br") : document.createTextNode(" "),
        );
      }
    });
    fragment.append(paragraph);
    previousBlockWasDocumentTitle = false;
  }

  return fragment;
};

const loadAgreementDocument = async (documentType) => {
  const loadId = ++agreementLoadId;
  agreementAcceptButton.disabled = true;
  agreementContent.setAttribute("aria-busy", "true");
  agreementContent.textContent = "Загрузка документа…";
  try {
    const response = await fetch(agreementDocuments[documentType]);
    if (!response.ok) {
      throw new Error(`Ошибка загрузки: ${response.status}`);
    }
    const text = await response.text();
    if (loadId === agreementLoadId) {
      agreementContent.replaceChildren(renderMarkdown(text));
      agreementContent.setAttribute("aria-busy", "false");
      agreementContent.scrollTop = 0;
      agreementAcceptButton.disabled = false;
    }
  } catch (error) {
    if (loadId === agreementLoadId) {
      agreementContent.textContent =
        `Не удалось загрузить документ. ${error.message}`;
      agreementContent.setAttribute("aria-busy", "false");
    }
  }
};

const closeAgreementSheet = () => {
  agreementSheet.hidden = true;
  agreementReturnFocus?.focus();
};

const openAgreementSheet = (trigger, documentType = "terms", allowAcceptance = true) => {
  agreementReturnFocus = trigger;
  if (window.matchMedia("(max-width: 420px)").matches) {
    window.scrollTo(0, 0);
  }
  const selectedTab =
    agreementTabs.find((tab) => tab.dataset.document === documentType) || agreementTabs[0];
  agreementTabs.forEach((tab) => {
    const selected = tab === selectedTab;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  agreementContent.setAttribute("aria-labelledby", selectedTab.id);
  agreementAcceptButton.hidden = !allowAcceptance;
  agreementNote.hidden = !allowAcceptance;
  agreementSheet.hidden = false;
  selectedTab.focus();
  loadAgreementDocument(selectedTab.dataset.document);
};

form.querySelector(".agreement-open").addEventListener("click", (event) => {
  openAgreementSheet(event.currentTarget);
});
agreementCheckbox.addEventListener("click", (event) => {
  if (agreementCheckbox.checked) {
    event.preventDefault();
    openAgreementSheet(agreementCheckbox);
  }
});
agreementCloseButton.addEventListener("click", closeAgreementSheet);
agreementTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    agreementTabs.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    agreementContent.setAttribute("aria-labelledby", tab.id);
    loadAgreementDocument(tab.dataset.document);
  });
});
agreementAcceptButton.addEventListener("click", () => {
  agreementCheckbox.checked = true;
  agreementCheckbox.dispatchEvent(new Event("input", { bubbles: true }));
  agreementCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
  closeAgreementSheet();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !agreementSheet.hidden) {
    closeAgreementSheet();
  }
});

const phoneScreen = document.querySelector(".phone");
const roleToggle = document.querySelector(".role-toggle");
const loginLink = document.querySelector(".login-link");
const clearAuthFormValidation = () => {
  authForms.forEach(clearFormValidation);
};
const resetPasswordVisibility = () => {
  [
    password,
    passwordConfirm,
    loginPanel.querySelector('[placeholder="Пароль"]'),
    recoveryPassword,
    recoveryPasswordConfirm,
  ].forEach((input) => {
    input.type = "password";
  });
  document.querySelectorAll(".registration-form .eye-btn, .login-eye, .recovery-eye")
    .forEach((button) => {
      button.setAttribute("aria-pressed", "false");
      button.setAttribute(
        "aria-label",
        button.classList.contains("login-eye") ? "Показать пароль" : "Показать оба пароля",
      );
      button.classList.remove("is-visible");
    });
};
const resetAuthScreenClasses = () => {
  resetPasswordVisibility();
  homeScreen.hidden = true;
  phoneScreen.classList.remove("is-login", "is-reset", "is-code", "is-new-password", "is-home");
  window.scrollTo(0, 0);
};

const showRegistration = () => {
  resetAuthScreenClasses();
  form.hidden = false;
  loginPanel.hidden = true;
  authFlowPanels.forEach((panel) => {
    panel.hidden = true;
  });
  clearAuthFormValidation();
  clearRecoveryInputs(true);
  roleToggle.hidden = false;
  loginLink.hidden = false;
  pageTitle.textContent = "Регистрация";
  welcomeMessage.textContent = "Добро пожаловать в B2B платформу!";
  clearFormStatus();
  shopName.focus({ preventScroll: true });
};

const showLogin = () => {
  resetAuthScreenClasses();
  phoneScreen.classList.add("is-login");
  form.hidden = true;
  loginPanel.hidden = false;
  authFlowPanels.forEach((panel) => {
    panel.hidden = true;
  });
  clearAuthFormValidation();
  clearRecoveryInputs(true);
  roleToggle.hidden = false;
  loginLink.hidden = true;
  pageTitle.textContent = "Вход";
  welcomeMessage.textContent = "Добро пожаловать!";
  clearFormStatus();
  loginPanel.querySelector("[data-phone-format]").focus({ preventScroll: true });
};

const showResetPassword = () => {
  resetAuthScreenClasses();
  phoneScreen.classList.add("is-reset");
  form.hidden = true;
  loginPanel.hidden = true;
  resetPasswordPanel.hidden = false;
  verificationPanel.hidden = true;
  newPasswordPanel.hidden = true;
  clearAuthFormValidation();
  clearRecoveryInputs(false);
  roleToggle.hidden = true;
  loginLink.hidden = true;
  pageTitle.textContent = "Восстановление пароля";
  welcomeMessage.textContent =
    "Пожалуйста, введите номер телефона — мы отправим SMS-код для восстановления аккаунта";
  clearFormStatus();
  recoveryPhoneInput.focus({ preventScroll: true });
};

const showVerification = () => {
  resetAuthScreenClasses();
  phoneScreen.classList.add("is-code");
  form.hidden = true;
  loginPanel.hidden = true;
  resetPasswordPanel.hidden = true;
  verificationPanel.hidden = false;
  newPasswordPanel.hidden = true;
  clearAuthFormValidation();
  roleToggle.hidden = true;
  loginLink.hidden = true;
  pageTitle.textContent = "Подтверждение номера";
  const digits = recoveryPhoneInput.value.replace(/\D/g, "");
  document.getElementById("recovery-phone-mask").textContent =
    `+996 ${digits.slice(0, 3)} **** ${digits.slice(-2)}`;
  clearRecoveryInputs(false);
  codeInputs[0].focus({ preventScroll: true });
};

const showNewPassword = () => {
  resetAuthScreenClasses();
  phoneScreen.classList.add("is-new-password");
  form.hidden = true;
  loginPanel.hidden = true;
  resetPasswordPanel.hidden = true;
  verificationPanel.hidden = true;
  newPasswordPanel.hidden = false;
  clearAuthFormValidation();
  clearRecoveryInputs(false);
  roleToggle.hidden = true;
  loginLink.hidden = true;
  pageTitle.textContent = "Создание нового пароля";
  welcomeMessage.textContent =
    "Пожалуйста, установите новый надёжный пароль для вашей учётной записи Zakup.KG";
  updatePasswordStrength();
  recoveryPassword.focus({ preventScroll: true });
};

const showShopHome = () => {
  resetAuthScreenClasses();
  phoneScreen.classList.add("is-home");
  form.hidden = true;
  loginPanel.hidden = true;
  authFlowPanels.forEach((panel) => {
    panel.hidden = true;
  });
  clearAuthFormValidation();
  clearRecoveryInputs(true);
  loginPanel.querySelector("[data-phone-format]").value = "";
  loginPanel.querySelector('[placeholder="Пароль"]').value = "";
  homeProducts.forEach((product) => {
    product.quantity = 0;
    product.selectedOfferId = product.offers[0].id;
  });
  homeOrders.length = 0;
  notificationSettings.lowStock = true;
  notificationSettings.newProducts = true;
  selectedAppTheme = "dark";
  phoneScreen.classList.remove("theme-light");
  profileData.storeName = "Мой магазин";
  profileData.storeId = "";
  profileData.phone = "";
  profileData.photoDataUrl = "";
  profilePhotoInput.value = "";
  profilePhotoReadId += 1;
  renderProfile();
  activeDetailProductId = null;
  roleToggle.hidden = true;
  loginLink.hidden = true;
  pageTitle.textContent = "Главная";
  welcomeMessage.textContent = "";
  clearFormStatus();
  homeScreen.hidden = false;
  homeSearchInput.value = "";
  selectHomeFilter("all");
  homeScreen.querySelector("#smart-order-details").hidden = true;
  homeScreen.querySelector(".smart-order-toggle").setAttribute("aria-expanded", "false");
  homeScreen.querySelector(".smart-order-full").hidden = true;
  homeScreen.querySelector(".smart-order-active").hidden = true;
  homeToast.hidden = true;
  setHomeTab("home");
  homeScreen.querySelector('[data-home-tab="home"]').focus({ preventScroll: true });
};

document.querySelector(".login-link a").addEventListener("click", (event) => {
  event.preventDefault();
  showLogin();
});
document.querySelector(".login-register-button").addEventListener("click", showRegistration);
document.querySelector(".login-eye").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const input = loginPanel.querySelector('[placeholder="Пароль"]');
  const isVisible = input.type === "text";
  input.type = isVisible ? "password" : "text";
  button.setAttribute("aria-pressed", String(!isVisible));
  button.setAttribute("aria-label", isVisible ? "Показать пароль" : "Скрыть пароль");
  button.classList.toggle("is-visible", !isVisible);
});
document.querySelector(".recovery-eye").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const isVisible = recoveryPassword.type === "text";
  [recoveryPassword, recoveryPasswordConfirm].forEach((input) => {
    input.type = isVisible ? "password" : "text";
  });
  button.setAttribute("aria-pressed", String(!isVisible));
  button.setAttribute(
    "aria-label",
    isVisible ? "Показать оба пароля" : "Скрыть оба пароля",
  );
  button.classList.toggle("is-visible", !isVisible);
});
document.querySelector(".forgot-password-link").addEventListener("click", () => {
  showResetPassword();
});
document.querySelectorAll('[data-auth-action="login"]').forEach((button) => {
  button.addEventListener("click", showLogin);
});
document.querySelector(".change-number").addEventListener("click", showResetPassword);

document.querySelectorAll("[data-account-type]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const isShop = tab.dataset.accountType === "shop";
    document.querySelectorAll("[data-account-type]").forEach((item) => {
      const isSelected = item === tab;
      item.classList.toggle("active", isSelected);
      item.setAttribute("aria-selected", String(isSelected));
    });
    accountType.value = tab.dataset.accountType;
    shopName.placeholder = isShop ? "Название магазина" : "Название поставщика";
    shopName.parentElement.setAttribute(
      "aria-label",
      isShop ? "Название магазина" : "Название поставщика",
    );
    address.placeholder = isShop
      ? "Адрес магазина / доставки"
      : "Адрес склада / доставки";
    address.parentElement.setAttribute(
      "aria-label",
      isShop ? "Адрес магазина / доставки" : "Адрес склада / доставки",
    );
    clearFormStatus();
  });
});

const validatePasswordConfirm = () => {
  passwordConfirm.setCustomValidity(
    passwordConfirm.value && passwordConfirm.value !== password.value
      ? "Пароли не совпадают"
      : "",
  );
};

const getValidationMessage = (input) => {
  const label =
    input.type === "checkbox"
      ? "Согласие с условиями"
      : input.closest(".field")?.getAttribute("aria-label") || "Поле";
  let detail;

  if (input.validity.valueMissing) {
    detail = input.type === "checkbox" ? "подтвердите согласие" : "заполните поле";
  } else if (
    (input === passwordConfirm || input === recoveryPasswordConfirm) &&
    input.validity.customError
  ) {
    detail = "пароли не совпадают";
  } else if (input.hasAttribute("data-phone-format")) {
    detail = "введите ровно 9 цифр номера после +996";
  } else if (input.dataset.exactDigits) {
    detail = `введите ровно ${input.dataset.exactDigits} цифр`;
  } else if (input.validity.tooShort) {
    detail = `введите не менее ${input.minLength} символов`;
  } else {
    detail = input.validationMessage || "проверьте значение";
  }

  return `${label}: ${detail}.`;
};

const updateAriaValidity = (currentForm) => {
  if (!currentForm.classList.contains("was-validated")) {
    return;
  }
  currentForm.querySelectorAll('input:not([type="hidden"])').forEach((input) => {
    input.setAttribute("aria-invalid", String(!input.validity.valid));
  });
};

const validateForm = (currentForm) => {
  currentForm.classList.add("was-validated");
  if (currentForm === form) {
    validatePasswordConfirm();
  } else if (currentForm === newPasswordPanel) {
    validateRecoveryPasswordConfirm();
  }

  updateAriaValidity(currentForm);
  const invalidInputs = [...currentForm.querySelectorAll('input:not([type="hidden"])')]
    .filter((input) => !input.validity.valid);
  if (invalidInputs.length) {
    const firstInvalid = invalidInputs[0];
    const otherErrors = invalidInputs.length - 1;
    const message = getValidationMessage(firstInvalid);
    setFormStatus(
      otherErrors
        ? `${message} Также проверьте остальные поля.`
        : message,
      "error",
    );
    firstInvalid.focus();
    return false;
  }

  return true;
};

const validateRecoveryPasswordConfirm = () => {
  recoveryPasswordConfirm.setCustomValidity(
    recoveryPasswordConfirm.value && recoveryPasswordConfirm.value !== recoveryPassword.value
      ? "Пароли не совпадают"
      : "",
  );
};

const updatePasswordStrength = () => {
  const strengthIndicator = document.querySelector(".password-strength");
  const text = strengthIndicator.querySelector("p");
  const value = recoveryPassword.value;
  const hasLowercase = /[a-zа-яё]/.test(value);
  const hasUppercase = /[A-ZА-ЯЁ]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSymbol = /[^a-zа-яё\d]/i.test(value);
  const characterTypes = [hasLowercase, hasUppercase, hasNumber, hasSymbol]
    .filter(Boolean).length;
  let strength = "empty";
  let label = "Надёжность пароля";

  if (value) {
    strength = "weak";
    label = "Слабый пароль";
    if (value.length >= 8) {
      strength = "medium";
      label = "Средний пароль";
    }
    if (value.length >= 12 && characterTypes >= 3) {
      strength = "strong";
      label = "Надёжный пароль";
    }
  }

  strengthIndicator.dataset.strength = strength;
  text.textContent = label;
};

const clearRecoveryInputs = (clearPhone) => {
  codeInputs.forEach((input) => {
    input.value = "";
    input.removeAttribute("aria-invalid");
  });
  recoveryPassword.value = "";
  recoveryPasswordConfirm.value = "";
  validateRecoveryPasswordConfirm();
  updatePasswordStrength();
  if (clearPhone) {
    recoveryPhoneInput.value = "";
  }
};

const homeProducts = [
  {
    id: "water",
    name: "Вода Легенда Шоро 0,5 л",
    unit: "блок",
    category: "drinks",
    supplier: "Шоро",
    stock: "В наличии",
    offers: [
      { id: "shoro", supplier: "Шоро", price: 60, minQuantity: 1, delivery: "Завтра до 12:00" },
      { id: "asia", supplier: "Азия Дистрибьюшн", price: 64, minQuantity: 2, delivery: "Сегодня до 18:00" },
    ],
    selectedOfferId: "shoro",
    image: "Concept%20Project/WebMaket/assets/home/water-bottle.png",
    sale: true,
    isNew: false,
    recommended: true,
    quantity: 0,
  },
  {
    id: "brownie",
    name: "Brunie",
    unit: "короб",
    category: "sweets",
    supplier: "Brunie",
    stock: "Демо-позиция",
    offers: [
      { id: "brunie-direct", supplier: "Brunie", price: 145, minQuantity: 1, delivery: "Завтра" },
      { id: "bakaleya", supplier: "Бакалея плюс", price: 152, minQuantity: 2, delivery: "Сегодня до 18:00" },
    ],
    selectedOfferId: "brunie-direct",
    sale: false,
    isNew: true,
    recommended: true,
    quantity: 0,
  },
  {
    id: "juice",
    name: "Сок Садочек 1 л",
    unit: "упаковка",
    category: "drinks",
    supplier: "Садочек",
    stock: "Демо-позиция",
    offers: [
      { id: "sadochek", supplier: "Садочек", price: 95, minQuantity: 1, delivery: "Завтра до 12:00" },
      { id: "nurlan", supplier: "Агент Нурлан", price: 99, minQuantity: 2, delivery: "Сегодня до 18:00" },
    ],
    selectedOfferId: "sadochek",
    sale: true,
    isNew: false,
    recommended: true,
    quantity: 0,
  },
  {
    id: "tea",
    name: "Чай 100 г",
    unit: "упаковка",
    category: "tea",
    supplier: "Чайные товары",
    stock: "Демо-позиция",
    offers: [
      { id: "tea-shop", supplier: "Чайные товары", price: 80, minQuantity: 1, delivery: "Завтра" },
      { id: "opt-service", supplier: "Опт-Сервис", price: 85, minQuantity: 3, delivery: "Сегодня до 18:00" },
    ],
    selectedOfferId: "tea-shop",
    sale: false,
    isNew: true,
    recommended: true,
    quantity: 0,
  },
];
const homeFeed = homeScreen.querySelector(".home-feed");
const profileView = homeScreen.querySelector("#home-profile-view");
const profileOverview = homeScreen.querySelector("#home-profile-overview");
const profileSubview = homeScreen.querySelector("#home-profile-subview");
const profileSubtitle = homeScreen.querySelector("#home-profile-subtitle");
const profileSubtitleNote = homeScreen.querySelector("#home-profile-subtitle-note");
const profileSubcontent = homeScreen.querySelector("#home-profile-subcontent");
const profileStoreName = homeScreen.querySelector("#home-profile-store-name");
const profileStoreId = homeScreen.querySelector("#home-profile-store-id");
const profilePhone = homeScreen.querySelector("#home-profile-phone");
const profileInitial = homeScreen.querySelector("#home-profile-initial");
const profilePhoto = homeScreen.querySelector("#home-profile-photo");
const profilePhotoInput = homeScreen.querySelector("#home-profile-photo-input");
const homeHeaderStoreName = homeScreen.querySelector(".home-store-info strong");
const homeHeaderInitial = homeScreen.querySelector("#home-header-profile-initial");
const homeHeaderPhoto = homeScreen.querySelector("#home-header-profile-photo");
const homeProductGrid = homeScreen.querySelector("#home-product-grid");
const homeEmpty = homeScreen.querySelector("#home-empty");
const homeSearchInput = homeScreen.querySelector("#home-search-input");
const catalogView = homeScreen.querySelector("#home-catalog-view");
const catalogGrid = homeScreen.querySelector("#home-catalog-grid");
const catalogEmpty = homeScreen.querySelector("#home-catalog-empty");
const catalogSearchInput = homeScreen.querySelector("#home-catalog-search");
const catalogCategoryButtons = [...homeScreen.querySelectorAll("[data-catalog-category]")];
const productDetailView = homeScreen.querySelector("#home-product-detail-view");
const productDetail = homeScreen.querySelector("#home-product-detail");
const cartView = homeScreen.querySelector("#home-cart-view");
const cartItems = homeScreen.querySelector("#home-cart-items");
const cartEmpty = homeScreen.querySelector("#home-cart-empty");
const cartSummary = homeScreen.querySelector("#home-cart-summary");
const cartTotal = homeScreen.querySelector("#home-cart-total");
const checkoutButton = homeScreen.querySelector('[data-home-action="checkout"]');
const ordersView = homeScreen.querySelector("#home-orders-view");
const ordersList = homeScreen.querySelector("#home-orders-list");
const ordersEmpty = homeScreen.querySelector("#home-orders-empty");
const notificationsView = homeScreen.querySelector("#home-notifications-view");
const notificationTitle = homeScreen.querySelector("#home-notifications-title");
const notificationTabs = homeScreen.querySelector(".home-notification-tabs");
const notificationList = homeScreen.querySelector("#home-notification-list");
const notificationDetail = homeScreen.querySelector("#home-notification-detail");
const notificationDetailIcon = homeScreen.querySelector("#home-notification-detail-icon");
const notificationDetailDate = homeScreen.querySelector("#home-notification-detail-date");
const notificationDetailTitle = homeScreen.querySelector("#home-notification-detail-title");
const notificationDetailSubtitle = homeScreen.querySelector("#home-notification-detail-subtitle");
const notificationDetailBody = homeScreen.querySelector("#home-notification-detail-body");
const notificationTabButtons = [...homeScreen.querySelectorAll("[data-notification-tab]")];
const homeMain = homeScreen.querySelector(".home-main");
const homeCartCount = homeScreen.querySelector("#home-cart-count");
const homeToast = homeScreen.querySelector(".home-toast");
const homeFilterButtons = [...homeScreen.querySelectorAll("[data-home-filter]")];
const homeSupplierFilters = homeScreen.querySelector(".home-supplier-filters");
const homeSupplierButtons = [...homeScreen.querySelectorAll("[data-home-supplier]")];
const homeNavButtons = [...homeScreen.querySelectorAll("[data-home-tab]")];
let selectedHomeFilter = "all";
let selectedHomeSupplier = "all";
let selectedCatalogCategory = "all";
let activeDetailProductId = null;
let detailQuantity = 1;
let selectedNotificationTab = "notifications";
let selectedAppTheme = "dark";
let activeNotificationItemId = null;
const homeOrders = [];
const notificationSettings = { lowStock: true, newProducts: true };
const demoNotificationItems = [
  {
    id: "loyalty",
    date: "13.11.2026 г.",
    title: "Повышение лояльности клиентов",
    subtitle: "Бонус за регистрацию",
    icon: "🎁",
    body: [
      "Мы подготовили приветственное предложение для новых магазинов. В рабочей версии здесь будут указаны сумма бонуса, условия и срок его действия.",
      "Это демонстрационный пример: начисление бонуса пока не подключено.",
    ],
    read: false,
  },
  {
    id: "welcome",
    date: "12.11.2026 г.",
    title: "Добро пожаловать в Zakup.KG",
    subtitle: "",
    icon: "👋",
    body: [
      "Спасибо, что присоединились к Zakup.KG. В каталоге можно находить товары и сравнивать предложения поставщиков, а в корзине — собирать заказ.",
      "Товары, цены и заказы в прототипе приведены для демонстрации.",
    ],
    read: true,
  },
];
const demoNewsItems = [
  {
    id: "control",
    date: "13.11.2026 г.",
    title: "Мы получили контроль над закупками",
    subtitle: "",
    icon: "📦",
    body: [
      "Теперь в Zakup.KG можно следить за наличием товаров и планировать закупки в одном месте.",
      "Это демонстрационный текст новости. Реальные публикации и сведения о поставщиках будут подключены позже.",
    ],
    read: false,
  },
  {
    id: "clients",
    date: "12.11.2026 г.",
    title: "Дорогие наши клиенты, рады сообщить!",
    subtitle: "",
    icon: "💚",
    body: [
      "Мы продолжаем развивать платформу, чтобы вы могли быстрее находить нужные товары и оформлять закупки.",
      "Следите за новостями — здесь будут появляться важные обновления Zakup.KG. Этот текст пока демонстрационный.",
    ],
    read: true,
  },
];
const profileData = { storeName: "Мой магазин", storeId: "", phone: "", photoDataUrl: "" };
const allowedProfilePhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxProfilePhotoSize = 5 * 1024 * 1024;
let profilePhotoReadId = 0;
let homeNoticeTimeout;

const formatMoney = (amount) => new Intl.NumberFormat("ru-RU").format(amount);
const getSelectedOffer = (product) =>
  product.offers.find((offer) => offer.id === product.selectedOfferId) || product.offers[0];

const createHomeProductActions = (product) => {
  const actions = document.createElement("div");
  actions.className = "home-product-actions";

  if (product.quantity > 0) {
    const decreaseButton = document.createElement("button");
    decreaseButton.className = "home-quantity-button";
    decreaseButton.type = "button";
    decreaseButton.dataset.quantityAction = "decrease";
    const offer = getSelectedOffer(product);
    const atMinimum = product.quantity <= offer.minQuantity;
    decreaseButton.setAttribute(
      "aria-label",
      atMinimum ? `Удалить ${product.name} из корзины` : `Уменьшить количество ${product.name}`,
    );
    decreaseButton.textContent = atMinimum ? "×" : "−";
    actions.append(decreaseButton);

    const quantity = document.createElement("span");
    quantity.className = "home-quantity-value";
    quantity.textContent = String(product.quantity);
    actions.append(quantity);

    const increaseButton = document.createElement("button");
    increaseButton.className = "home-quantity-button";
    increaseButton.type = "button";
    increaseButton.dataset.quantityAction = "increase";
    increaseButton.setAttribute("aria-label", `Добавить ${product.name}`);
    increaseButton.textContent = "+";
    actions.append(increaseButton);
  } else {
    const addButton = document.createElement("button");
    addButton.className = "home-quantity-button home-add-button";
    addButton.type = "button";
    addButton.dataset.quantityAction = "increase";
    addButton.setAttribute("aria-label", `Добавить ${product.name}`);
    addButton.textContent = "+";
    actions.append(addButton);
  }

  return actions;
};

const updateHomeCartCount = () => {
  const count = homeProducts.reduce((total, product) => total + product.quantity, 0);
  homeCartCount.textContent = String(count);
  homeCartCount.hidden = count === 0;
  homeScreen.querySelector('[data-home-tab="cart"]').setAttribute(
    "aria-label",
    count ? `Корзина, товаров: ${count}` : "Корзина",
  );
};

const createHomeProductCard = (product) => {
  const card = document.createElement("article");
  card.className = "home-product-card";
  card.dataset.productId = product.id;

  const imageArea = document.createElement("div");
  imageArea.className = "home-product-image";
  if (product.image) {
    const image = document.createElement("img");
    image.src = product.image;
    image.alt = product.name;
    imageArea.append(image);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "home-product-placeholder";
    placeholder.textContent = "Фото скоро появится";
    imageArea.append(placeholder);
  }
  card.append(imageArea);

  const title = document.createElement("h3");
  title.textContent = product.name;
  card.append(title);

  const offer = getSelectedOffer(product);
  const price = document.createElement("p");
  price.className = "home-product-price";
  price.textContent = `Демо: ${formatMoney(offer.price)} сом / ${product.unit}`;
  card.append(price);

  const stock = document.createElement("p");
  stock.className = "home-product-stock";
  stock.textContent = product.stock;
  card.append(stock);

  const supplier = document.createElement("p");
  supplier.className = "home-product-supplier";
  supplier.textContent = `Поставщик: ${offer.supplier}`;
  card.append(supplier);

  const openButton = document.createElement("button");
  openButton.className = "home-product-open";
  openButton.type = "button";
  openButton.dataset.openProduct = product.id;
  openButton.textContent = "Выбрать поставщика";
  card.append(openButton);
  card.append(createHomeProductActions(product));
  return card;
};

const renderHomeProducts = () => {
  const query = homeSearchInput.value.trim().toLocaleLowerCase("ru");
  const matchingProducts = homeProducts.filter((product) => {
    const matchesQuery =
      !query ||
      `${product.name} ${product.offers.map((offer) => offer.supplier).join(" ")}`
        .toLocaleLowerCase("ru")
        .includes(query);
    const matchesFilter =
      selectedHomeFilter === "all" ||
      (selectedHomeFilter === "supplier" &&
        (selectedHomeSupplier === "all" || product.supplier === selectedHomeSupplier)) ||
      (selectedHomeFilter === "sale" && product.sale) ||
      (selectedHomeFilter === "new" && product.isNew);
    return matchesQuery && matchesFilter;
  });

  homeProductGrid.replaceChildren(
    ...matchingProducts.map((product) => createHomeProductCard(product)),
  );
  homeEmpty.hidden = matchingProducts.length > 0;
  updateHomeCartCount();
};

const renderCatalogProducts = () => {
  const query = catalogSearchInput.value.trim().toLocaleLowerCase("ru");
  const matchingProducts = homeProducts.filter((product) => {
    const matchesQuery =
      !query ||
      `${product.name} ${product.offers.map((offer) => offer.supplier).join(" ")}`
        .toLocaleLowerCase("ru")
        .includes(query);
    return (
      matchesQuery &&
      (selectedCatalogCategory === "all" || product.category === selectedCatalogCategory)
    );
  });
  catalogGrid.replaceChildren(
    ...matchingProducts.map((product) => createHomeProductCard(product)),
  );
  catalogEmpty.hidden = matchingProducts.length > 0;
  updateHomeCartCount();
};

const renderProductDetail = (product) => {
  activeDetailProductId = product.id;
  const offer = getSelectedOffer(product);
  const backButton = document.createElement("button");
  backButton.className = "home-back-button";
  backButton.type = "button";
  backButton.dataset.homeAction = "back-to-catalog";
  backButton.textContent = "‹  Назад в каталог";

  const card = document.createElement("div");
  card.className = "home-product-detail-card";
  const imageArea = document.createElement("div");
  imageArea.className = "home-product-image";
  if (product.image) {
    const image = document.createElement("img");
    image.src = product.image;
    image.alt = product.name;
    imageArea.append(image);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "home-product-placeholder";
    placeholder.textContent = "Фото скоро появится";
    imageArea.append(placeholder);
  }
  card.append(imageArea);

  const title = document.createElement("h2");
  title.className = "home-product-detail-title";
  title.textContent = product.name;
  card.append(title);

  const note = document.createElement("p");
  note.className = "home-detail-note";
  note.textContent = `${product.stock}. Цены и условия — демонстрационные.`;
  card.append(note);

  const offerHeading = document.createElement("strong");
  offerHeading.textContent = "Предложения поставщиков";
  card.append(offerHeading);

  const offers = document.createElement("div");
  offers.className = "home-offer-list";
  product.offers.forEach((productOffer) => {
    const button = document.createElement("button");
    button.className = "home-offer-option";
    button.classList.toggle("is-selected", productOffer.id === offer.id);
    button.type = "button";
    button.dataset.detailOffer = productOffer.id;
    button.setAttribute("aria-pressed", String(productOffer.id === offer.id));

    const info = document.createElement("span");
    info.className = "home-offer-info";
    const supplierName = document.createElement("strong");
    supplierName.textContent = productOffer.supplier;
    const conditions = document.createElement("span");
    conditions.textContent =
      `Минимум ${productOffer.minQuantity} ${product.unit} · ${productOffer.delivery}`;
    info.append(supplierName, conditions);

    const amount = document.createElement("span");
    amount.className = "home-offer-price";
    amount.textContent = `${formatMoney(productOffer.price)} сом`;
    button.append(info, amount);
    offers.append(button);
  });
  card.append(offers);

  const quantityRow = document.createElement("div");
  quantityRow.className = "home-detail-quantity";
  const quantityLabel = document.createElement("span");
  quantityLabel.textContent = `Количество (${product.unit})`;
  const stepper = document.createElement("span");
  stepper.className = "home-detail-stepper";
  const decrease = document.createElement("button");
  decrease.type = "button";
  decrease.dataset.detailQuantity = "decrease";
  decrease.setAttribute("aria-label", "Уменьшить количество");
  decrease.textContent = "−";
  decrease.disabled = detailQuantity <= offer.minQuantity;
  const quantity = document.createElement("strong");
  quantity.textContent = String(detailQuantity);
  const increase = document.createElement("button");
  increase.type = "button";
  increase.dataset.detailQuantity = "increase";
  increase.setAttribute("aria-label", "Увеличить количество");
  increase.textContent = "+";
  stepper.append(decrease, quantity, increase);
  quantityRow.append(quantityLabel, stepper);
  card.append(quantityRow);

  const addButton = document.createElement("button");
  addButton.className = "home-add-to-cart";
  addButton.type = "button";
  addButton.dataset.homeAction = "add-detail-to-cart";
  addButton.textContent =
    `Добавить в корзину · ${formatMoney(offer.price * detailQuantity)} сом`;
  card.append(addButton);
  productDetail.replaceChildren(backButton, card);
};

const renderHomeCart = () => {
  const items = homeProducts.filter((product) => product.quantity > 0);
  cartEmpty.hidden = items.length > 0;
  cartSummary.hidden = items.length === 0;
  checkoutButton.disabled = items.length === 0;
  cartItems.replaceChildren();
  let total = 0;

  items.forEach((product) => {
    const offer = getSelectedOffer(product);
    const lineTotal = offer.price * product.quantity;
    total += lineTotal;

    const item = document.createElement("article");
    item.className = "home-cart-item";
    const title = document.createElement("h3");
    title.textContent = product.name;
    const select = document.createElement("select");
    select.dataset.cartOffer = product.id;
    select.setAttribute("aria-label", `Поставщик товара ${product.name}`);
    product.offers.forEach((productOffer) => {
      const option = document.createElement("option");
      option.value = productOffer.id;
      option.textContent =
        `${productOffer.supplier} — ${formatMoney(productOffer.price)} сом / ${product.unit}`;
      option.selected = productOffer.id === product.selectedOfferId;
      select.append(option);
    });

    const summary = document.createElement("div");
    summary.className = "home-cart-item-summary";
    const unitPrice = document.createElement("span");
    unitPrice.textContent = `${product.quantity} × ${formatMoney(offer.price)} сом`;
    const itemTotal = document.createElement("strong");
    itemTotal.textContent = `${formatMoney(lineTotal)} сом`;
    summary.append(unitPrice, itemTotal);

    const stepper = document.createElement("div");
    stepper.className = "home-cart-stepper";
    const decrease = document.createElement("button");
    decrease.type = "button";
    decrease.dataset.cartStep = `${product.id}:decrease`;
    const atMinimum = product.quantity <= offer.minQuantity;
    decrease.setAttribute(
      "aria-label",
      atMinimum ? `Удалить ${product.name} из корзины` : `Уменьшить количество ${product.name}`,
    );
    decrease.textContent = atMinimum ? "×" : "−";
    const quantity = document.createElement("strong");
    quantity.textContent = String(product.quantity);
    const increase = document.createElement("button");
    increase.type = "button";
    increase.dataset.cartStep = `${product.id}:increase`;
    increase.setAttribute("aria-label", `Добавить одну единицу товара ${product.name}`);
    increase.textContent = "+";
    stepper.append(decrease, quantity, increase);
    item.append(title, select, summary, stepper);
    cartItems.append(item);
  });

  cartTotal.textContent = `${formatMoney(total)} сом`;
  updateHomeCartCount();
};

const renderHomeOrders = () => {
  ordersList.replaceChildren();
  ordersEmpty.hidden = homeOrders.length > 0;
  homeOrders.forEach((order) => {
    const card = document.createElement("article");
    card.className = "home-order-card";
    const heading = document.createElement("h3");
    heading.textContent = `Заказ ${order.id}`;
    const status = document.createElement("span");
    status.className = "home-order-status";
    status.textContent = "Создан в демо";
    const date = document.createElement("p");
    date.textContent = order.date;
    card.append(heading, status, date);
    order.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "home-order-item";
      const description = document.createElement("span");
      description.textContent =
        `${item.name} · ${item.quantity} ${item.unit} · ${item.supplier}, ${item.delivery}`;
      const amount = document.createElement("strong");
      amount.textContent = `${formatMoney(item.price * item.quantity)} сом`;
      row.append(description, amount);
      card.append(row);
    });
    const total = document.createElement("div");
    total.className = "home-order-total";
    const totalLabel = document.createElement("span");
    totalLabel.textContent = "Итого";
    const totalAmount = document.createElement("strong");
    totalAmount.textContent = `${formatMoney(order.total)} сом`;
    total.append(totalLabel, totalAmount);
    const disclaimer = document.createElement("p");
    disclaimer.textContent = "Заказ сохранён в демо-сессии; поставщик не уведомлён.";
    card.append(total, disclaimer);
    ordersList.append(card);
  });
};

const renderProfile = () => {
  const storeName = profileData.storeName || "Мой магазин";
  profileStoreName.textContent = storeName;
  profileStoreId.textContent = profileData.storeId
    ? `ID ${profileData.storeId}`
    : "ID магазина не указан";
  profilePhone.textContent = profileData.phone || "Телефон не сохраняется в демо";
  const initial = storeName.charAt(0).toLocaleUpperCase("ru-RU") || "М";
  const hasPhoto = Boolean(profileData.photoDataUrl);
  profileInitial.textContent = initial;
  profileInitial.hidden = hasPhoto;
  profilePhoto.hidden = !hasPhoto;
  homeHeaderInitial.textContent = initial;
  homeHeaderInitial.hidden = hasPhoto;
  homeHeaderPhoto.hidden = !hasPhoto;
  if (profileData.photoDataUrl) {
    profilePhoto.src = profileData.photoDataUrl;
    homeHeaderPhoto.src = profileData.photoDataUrl;
  } else {
    profilePhoto.removeAttribute("src");
    homeHeaderPhoto.removeAttribute("src");
  }
  homeHeaderStoreName.textContent = storeName;
};

const setAppTheme = (theme) => {
  selectedAppTheme = theme;
  phoneScreen.classList.toggle("theme-light", selectedAppTheme === "light");
  homeScreen.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === selectedAppTheme));
  });
};

const renderProfilePage = (page) => {
  profileOverview.hidden = true;
  profileSubview.hidden = false;
  homeScreen.classList.add("is-profile-subview");
  profileSubcontent.replaceChildren();

  const pageInfo = {
    edit: ["Редактировать профиль", "Изменения останутся только в этой демо-сессии."],
    support: ["Служба поддержки", "Канал связи ещё не подключён."],
    documents: ["Накладные и документы", "Документы не отправляются и не сохраняются в демо."],
    settings: ["Настройки", "Тема и переключатели применяются только в этой демо-сессии."],
    legal: ["Договоры и правила", "Ознакомьтесь с документами Zakup.KG."],
    suppliers: ["Мои поставщики", "Поставщики и ассортимент показаны для демонстрации."],
  };
  const [title, note] = pageInfo[page] || pageInfo.settings;
  profileSubtitle.textContent = title;
  profileSubtitleNote.textContent = note;

  if (page === "edit") {
    const form = document.createElement("form");
    form.className = "home-profile-edit-form";
    form.dataset.profileEdit = "true";
    [
      { name: "storeName", label: "Название магазина", value: profileData.storeName, required: true },
      { name: "storeId", label: "ID магазина", value: profileData.storeId, placeholder: "Необязательно" },
      { name: "phone", label: "Номер телефона", value: profileData.phone, type: "tel", placeholder: "+996" },
    ].forEach((fieldData) => {
      const field = document.createElement("label");
      field.className = "home-profile-field";
      const label = document.createElement("span");
      label.textContent = fieldData.label;
      const input = document.createElement("input");
      input.name = fieldData.name;
      input.type = fieldData.type || "text";
      input.value = fieldData.value;
      input.placeholder = fieldData.placeholder || "";
      input.required = Boolean(fieldData.required);
      field.append(label, input);
      form.append(field);
    });
    const storeNameInput = form.elements.namedItem("storeName");
    storeNameInput.addEventListener("input", () => {
      storeNameInput.setCustomValidity(
        storeNameInput.value.trim() ? "" : "Введите название магазина.",
      );
    });
    const save = document.createElement("button");
    save.className = "home-profile-save";
    save.type = "submit";
    save.textContent = "Сохранить";
    form.append(save);
    profileSubcontent.append(form);
    return;
  }

  if (page === "suppliers") {
    const supplierProducts = new Map();
    homeProducts.forEach((product) => {
      product.offers.forEach((offer) => {
        const products = supplierProducts.get(offer.supplier) || [];
        products.push({ product, offer });
        supplierProducts.set(offer.supplier, products);
      });
    });
    const list = document.createElement("div");
    list.className = "home-profile-list";
    supplierProducts.forEach((entries, supplier) => {
      const item = document.createElement("article");
      item.className = "home-profile-list-item";
      const name = document.createElement("strong");
      name.textContent = supplier;
      const products = document.createElement("span");
      products.textContent = entries
        .map(({ product, offer }) =>
          `${product.name} · ${formatMoney(offer.price)} сом / ${product.unit}`,
        )
        .join(" · ");
      item.append(name, products);
      list.append(item);
    });
    profileSubcontent.append(list);
    return;
  }

  if (page === "support") {
    const message = document.createElement("p");
    message.className = "home-profile-message";
    message.textContent =
      "В демонстрационной версии сообщения не отправляются. Контакты поддержки появятся после подключения сервера.";
    profileSubcontent.append(message);
    return;
  }

  if (page === "documents") {
    const message = document.createElement("p");
    message.className = "home-profile-message";
    message.textContent = homeOrders.length
      ? `В демо создано заказов: ${homeOrders.length}. PDF-накладные пока не формируются.`
      : "Накладные и документы появятся после подключения реальных заказов.";
    const ordersButton = document.createElement("button");
    ordersButton.className = "home-profile-secondary";
    ordersButton.type = "button";
    ordersButton.dataset.homeAction = "open-orders";
    ordersButton.textContent = "Открыть историю заказов";
    profileSubcontent.append(message, ordersButton);
    return;
  }

  if (page === "legal") {
    const documents = [
      ["terms", "Пользовательское соглашение"],
      ["offer", "Публичная оферта"],
      ["privacy", "Политика конфиденциальности"],
    ];
    const list = document.createElement("div");
    list.className = "home-profile-list";
    documents.forEach(([documentType, documentTitle]) => {
      const button = document.createElement("button");
      button.className = "home-profile-document-button";
      button.type = "button";
      button.dataset.profileDocument = documentType;
      button.textContent = documentTitle;
      list.append(button);
    });
    profileSubcontent.append(list);
    return;
  }

  const themeControl = document.createElement("section");
  themeControl.className = "home-profile-theme-control";
  const themeCopy = document.createElement("div");
  themeCopy.className = "home-profile-theme-copy";
  const themeTitle = document.createElement("strong");
  themeTitle.textContent = "Тема оформления";
  const themeDescription = document.createElement("small");
  themeDescription.textContent = "Выберите тёмную или светлую тему";
  themeCopy.append(themeTitle, themeDescription);

  const themeOptions = document.createElement("div");
  themeOptions.className = "home-profile-theme-options";
  themeOptions.setAttribute("role", "group");
  themeOptions.setAttribute("aria-label", "Тема оформления");
  [
    ["dark", "Тёмная"],
    ["light", "Светлая"],
  ].forEach(([theme, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.themeChoice = theme;
    button.textContent = label;
    button.setAttribute("aria-pressed", String(theme === selectedAppTheme));
    themeOptions.append(button);
  });
  themeControl.append(themeCopy, themeOptions);

  const list = document.createElement("div");
  list.className = "home-profile-list";
  [
    {
      key: "lowStock",
      title: "Остатки и пополнение",
      description: "Напоминания о товарах, которые заканчиваются",
    },
    {
      key: "newProducts",
      title: "Новинки и предложения",
      description: "Сообщения о новых товарах и демо-предложениях",
    },
  ].forEach((setting) => {
    const item = document.createElement("div");
    item.className = "home-profile-setting";
    const text = document.createElement("span");
    const settingTitle = document.createElement("strong");
    settingTitle.textContent = setting.title;
    const description = document.createElement("small");
    description.textContent = setting.description;
    text.append(settingTitle, description);
    const toggle = document.createElement("button");
    toggle.className = "home-profile-switch";
    toggle.type = "button";
    toggle.dataset.profileSetting = setting.key;
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", setting.title);
    toggle.setAttribute("aria-checked", String(notificationSettings[setting.key]));
    item.append(text, toggle);
    list.append(item);
  });
  const suppliersButton = document.createElement("button");
  suppliersButton.className = "home-profile-document-button";
  suppliersButton.type = "button";
  suppliersButton.dataset.profilePage = "suppliers";
  suppliersButton.textContent = "Мои поставщики";
  profileSubcontent.append(themeControl, list, suppliersButton);
  setAppTheme(selectedAppTheme);
};

const selectHomeFilter = (filter) => {
  selectedHomeFilter = filter;
  selectedHomeSupplier = "all";
  homeSupplierFilters.hidden = filter !== "supplier";
  homeSupplierButtons.forEach((button) => {
    const selected = button.dataset.homeSupplier === "all";
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  homeFilterButtons.forEach((button) => {
    const selected = button.dataset.homeFilter === filter;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  renderHomeProducts();
};

const selectHomeSupplier = (supplier) => {
  selectedHomeSupplier = supplier;
  homeSupplierButtons.forEach((button) => {
    const selected = button.dataset.homeSupplier === supplier;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  renderHomeProducts();
};

const setHomeTab = (tabName) => {
  homeMain.scrollTop = 0;
  homeScreen.classList.remove("is-notifications-open");
  homeScreen.classList.remove("is-profile-subview");
  homeScreen.classList.toggle("is-profile", tabName === "profile");
  homeScreen.classList.toggle("is-header-hidden", tabName !== "home");
  homeNavButtons.forEach((button) => {
    const selected = button.dataset.homeTab === tabName;
    button.classList.toggle("is-current", selected);
    if (selected) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  homeFeed.hidden = tabName !== "home";
  catalogView.hidden = tabName !== "catalog" || activeDetailProductId !== null;
  productDetailView.hidden = tabName !== "catalog" || activeDetailProductId === null;
  cartView.hidden = tabName !== "cart";
  ordersView.hidden = tabName !== "orders";
  profileView.hidden = tabName !== "profile";
  notificationsView.hidden = true;

  if (tabName !== "catalog") {
    activeDetailProductId = null;
  } else {
    renderCatalogProducts();
  }
  if (tabName === "cart") {
    renderHomeCart();
  } else if (tabName === "orders") {
    renderHomeOrders();
  } else if (tabName === "profile") {
    profileOverview.hidden = false;
    profileSubview.hidden = true;
    renderProfile();
  }
};

const showHomeNotice = (message) => {
  homeToast.textContent = message;
  homeToast.hidden = false;
  window.clearTimeout(homeNoticeTimeout);
  homeNoticeTimeout = window.setTimeout(() => {
    homeToast.hidden = true;
  }, 2800);
};

const renderNotificationList = () => {
  const items = selectedNotificationTab === "news" ? demoNewsItems : demoNotificationItems;
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item.date)) {
      groups.set(item.date, []);
    }
    groups.get(item.date).push(item);
  });

  notificationList.replaceChildren();
  notificationList.hidden = false;
  notificationTabs.hidden = false;
  notificationDetail.hidden = true;
  groups.forEach((groupItems, date) => {
    const group = document.createElement("section");
    group.className = "home-notification-group";

    const dateHeading = document.createElement("h3");
    dateHeading.className = "home-notification-date";
    dateHeading.textContent = date;
    group.append(dateHeading);

    groupItems.forEach((item) => {
      const card = document.createElement("button");
      card.className = `home-notification-item ${item.read ? "is-read" : "is-unread"}`;
      card.type = "button";
      card.dataset.notificationId = item.id;
      card.setAttribute(
        "aria-label",
        `${item.date} ${item.title}${item.subtitle ? `. ${item.subtitle}` : ""}. ${
          item.read ? "Прочитано" : "Непрочитано, нажмите, чтобы отметить прочитанным"
        }`,
      );

      const marker = document.createElement("span");
      marker.className = "home-notification-marker";
      marker.textContent = item.icon;
      marker.setAttribute("aria-hidden", "true");

      const copy = document.createElement("span");
      copy.className = "home-notification-copy";
      const title = document.createElement("strong");
      title.textContent = item.title;
      copy.append(title);
      if (item.subtitle) {
        const subtitle = document.createElement("span");
        subtitle.className = "home-notification-subtitle";
        subtitle.textContent = item.subtitle;
        copy.append(subtitle);
      }

      card.append(marker, copy);
      group.append(card);
    });

    notificationList.append(group);
  });
};

const renderNotificationDetail = (item) => {
  activeNotificationItemId = item.id;
  item.read = true;
  notificationTabs.hidden = true;
  notificationList.hidden = true;
  notificationDetail.hidden = false;
  notificationDetailIcon.textContent = item.icon;
  notificationDetailDate.textContent = item.date;
  notificationDetailTitle.textContent = item.title;
  notificationDetailSubtitle.textContent = item.subtitle;
  notificationDetailSubtitle.hidden = !item.subtitle;
  notificationDetailBody.replaceChildren();
  item.body.forEach((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    notificationDetailBody.append(paragraph);
  });
  homeMain.scrollTop = 0;
  notificationDetailTitle.focus();
};

const setNotificationTab = (tabName) => {
  activeNotificationItemId = null;
  selectedNotificationTab = tabName;
  const isNews = tabName === "news";
  notificationTitle.textContent = isNews ? "Новости" : "Уведомление";
  notificationTabButtons.forEach((button) => {
    const selected = button.dataset.notificationTab === tabName;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  const selectedTab = notificationTabButtons.find((button) => button.dataset.notificationTab === tabName);
  notificationList.setAttribute("aria-labelledby", selectedTab.id);
  renderNotificationList();
};

const openNotificationCenter = () => {
  setHomeTab("home");
  activeNotificationItemId = null;
  setNotificationTab("notifications");
  homeFeed.hidden = true;
  notificationsView.hidden = false;
  homeScreen.classList.add("is-notifications-open");
  notificationList.scrollTop = 0;
  homeScreen.querySelector(".home-notifications-back").focus();
};

const closeNotificationDetail = () => {
  const itemId = activeNotificationItemId;
  activeNotificationItemId = null;
  renderNotificationList();
  const itemButton = notificationList.querySelector(`[data-notification-id="${itemId}"]`);
  if (itemButton) {
    itemButton.focus();
  }
};

const closeNotificationCenter = () => {
  if (activeNotificationItemId) {
    closeNotificationDetail();
    return;
  }
  setHomeTab("home");
  const notificationsButton = homeScreen.querySelector('[data-home-action="notifications"]');
  if (notificationsButton) {
    notificationsButton.focus();
  }
};

notificationsView.addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-notification-tab]");
  if (tabButton) {
    setNotificationTab(tabButton.dataset.notificationTab);
    return;
  }

  const itemButton = event.target.closest("[data-notification-id]");
  if (!itemButton) {
    return;
  }
  const items = selectedNotificationTab === "news" ? demoNewsItems : demoNotificationItems;
  const item = items.find((entry) => entry.id === itemButton.dataset.notificationId);
  if (!item) {
    return;
  }
  renderNotificationDetail(item);
});

const placeDemoOrder = () => {
  const items = homeProducts
    .filter((product) => product.quantity > 0)
    .map((product) => {
      const offer = getSelectedOffer(product);
      return {
        name: product.name,
        quantity: product.quantity,
        unit: product.unit,
        price: offer.price,
        supplier: offer.supplier,
        delivery: offer.delivery,
      };
    });
  if (items.length === 0) {
    showHomeNotice("Добавьте товары в корзину перед оформлением.");
    return;
  }

  const order = {
    id: `ДЕМО-${String(homeOrders.length + 1).padStart(4, "0")}`,
    date: new Date().toLocaleString("ru-RU"),
    items,
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  };
  homeOrders.unshift(order);
  homeProducts.forEach((product) => {
    product.quantity = 0;
  });
  renderHomeProducts();
  renderCatalogProducts();
  setHomeTab("orders");
  showHomeNotice("Демо-заказ создан. Поставщик не уведомлён.");
};

const handleProductGridClick = (event) => {
  const openButton = event.target.closest("[data-open-product]");
  if (openButton) {
    const product = homeProducts.find((item) => item.id === openButton.dataset.openProduct);
    setHomeTab("catalog");
    detailQuantity = Math.max(product.quantity, getSelectedOffer(product).minQuantity);
    renderProductDetail(product);
    catalogView.hidden = true;
    productDetailView.hidden = false;
    return;
  }

  const button = event.target.closest("[data-quantity-action]");
  if (!button) {
    return;
  }
  const card = button.closest("[data-product-id]");
  const product = homeProducts.find((item) => item.id === card.dataset.productId);
  const offer = getSelectedOffer(product);
  if (button.dataset.quantityAction === "increase") {
    product.quantity = Math.max(offer.minQuantity, product.quantity + 1);
  } else if (product.quantity <= offer.minQuantity) {
    product.quantity = 0;
  } else {
    product.quantity -= 1;
  }
  renderHomeProducts();
  renderCatalogProducts();
  renderHomeCart();
};
homeProductGrid.addEventListener("click", handleProductGridClick);
catalogGrid.addEventListener("click", handleProductGridClick);

catalogSearchInput.addEventListener("input", renderCatalogProducts);
catalogCategoryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedCatalogCategory = button.dataset.catalogCategory;
    catalogCategoryButtons.forEach((categoryButton) => {
      const selected = categoryButton === button;
      categoryButton.classList.toggle("is-selected", selected);
      categoryButton.setAttribute("aria-pressed", String(selected));
    });
    renderCatalogProducts();
  });
});

profileView.addEventListener("click", (event) => {
  const documentButton = event.target.closest("[data-profile-document]");
  if (documentButton) {
    openAgreementSheet(
      documentButton,
      documentButton.dataset.profileDocument,
      false,
    );
    return;
  }

  const pageButton = event.target.closest("[data-profile-page]");
  if (pageButton) {
    renderProfilePage(pageButton.dataset.profilePage);
    return;
  }

  const themeButton = event.target.closest("[data-theme-choice]");
  if (themeButton) {
    setAppTheme(themeButton.dataset.themeChoice);
    return;
  }

  const toggle = event.target.closest("[data-profile-setting]");
  if (toggle) {
    const setting = toggle.dataset.profileSetting;
    notificationSettings[setting] = !notificationSettings[setting];
    toggle.setAttribute("aria-checked", String(notificationSettings[setting]));
    showHomeNotice("Настройка действует только в этой демо-сессии.");
  }
});
profileView.addEventListener("submit", (event) => {
  const editForm = event.target.closest("[data-profile-edit]");
  if (!editForm) {
    return;
  }
  event.preventDefault();
  const storeNameInput = editForm.elements.namedItem("storeName");
  const storeName = storeNameInput.value.trim();
  if (!storeName) {
    storeNameInput.setCustomValidity("Введите название магазина.");
    storeNameInput.reportValidity();
    return;
  }
  storeNameInput.setCustomValidity("");
  profileData.storeName = storeName;
  profileData.storeId = editForm.elements.namedItem("storeId").value.trim();
  profileData.phone = editForm.elements.namedItem("phone").value.trim();
  profileSubview.hidden = true;
  profileOverview.hidden = false;
  homeScreen.classList.remove("is-profile-subview");
  renderProfile();
  showHomeNotice("Профиль обновлён только в демо-сессии.");
});
profilePhotoInput.addEventListener("change", () => {
  const [file] = profilePhotoInput.files;
  profilePhotoInput.value = "";
  const readId = ++profilePhotoReadId;
  if (!file) {
    return;
  }
  if (!allowedProfilePhotoTypes.has(file.type)) {
    showHomeNotice("Выберите изображение JPG, PNG или WebP.");
    return;
  }
  if (file.size > maxProfilePhotoSize) {
    showHomeNotice("Размер фото не должен превышать 5 МБ.");
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (readId !== profilePhotoReadId) {
      return;
    }
    if (typeof reader.result !== "string") {
      showHomeNotice("Не удалось прочитать файл изображения.");
      return;
    }
    profileData.photoDataUrl = reader.result;
    renderProfile();
    showHomeNotice("Фото обновлено в этой демо-сессии.");
  });
  reader.addEventListener("error", () => {
    if (readId === profilePhotoReadId) {
      showHomeNotice("Не удалось прочитать файл изображения.");
    }
  });
  reader.readAsDataURL(file);
});
profilePhoto.addEventListener("error", () => {
  if (profilePhoto.getAttribute("src") !== profileData.photoDataUrl) {
    return;
  }
  profileData.photoDataUrl = "";
  renderProfile();
  showHomeNotice("Файл не удалось открыть как изображение.");
});

productDetail.addEventListener("click", (event) => {
  const product = homeProducts.find((item) => item.id === activeDetailProductId);
  const offerButton = event.target.closest("[data-detail-offer]");
  if (offerButton) {
    product.selectedOfferId = offerButton.dataset.detailOffer;
    detailQuantity = Math.max(detailQuantity, getSelectedOffer(product).minQuantity);
    renderProductDetail(product);
    return;
  }

  const quantityButton = event.target.closest("[data-detail-quantity]");
  if (quantityButton) {
    const minimum = getSelectedOffer(product).minQuantity;
    detailQuantity = Math.max(
      minimum,
      detailQuantity + (quantityButton.dataset.detailQuantity === "increase" ? 1 : -1),
    );
    renderProductDetail(product);
  }
});

cartItems.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cart-step]");
  if (!button) {
    return;
  }
  const [productId, action] = button.dataset.cartStep.split(":");
  const product = homeProducts.find((item) => item.id === productId);
  const offer = getSelectedOffer(product);
  product.quantity =
    action === "increase"
      ? product.quantity + 1
      : product.quantity <= offer.minQuantity
        ? 0
        : product.quantity - 1;
  renderHomeProducts();
  renderCatalogProducts();
  renderHomeCart();
});

cartItems.addEventListener("change", (event) => {
  const select = event.target.closest("[data-cart-offer]");
  if (!select) {
    return;
  }
  const product = homeProducts.find((item) => item.id === select.dataset.cartOffer);
  product.selectedOfferId = select.value;
  product.quantity = Math.max(product.quantity, getSelectedOffer(product).minQuantity);
  renderHomeProducts();
  renderCatalogProducts();
  renderHomeCart();
});

homeFilterButtons.forEach((button) => {
  button.addEventListener("click", () => selectHomeFilter(button.dataset.homeFilter));
});
homeSupplierButtons.forEach((button) => {
  button.addEventListener("click", () => selectHomeSupplier(button.dataset.homeSupplier));
});
homeSearchInput.addEventListener("input", renderHomeProducts);
homeNavButtons.forEach((button) => {
  button.addEventListener("click", () => setHomeTab(button.dataset.homeTab));
});
homeScreen.addEventListener("click", (event) => {
  const button = event.target.closest("[data-home-action]");
  if (!button) {
    return;
  }
  switch (button.dataset.homeAction) {
    case "toggle-stock": {
      const details = homeScreen.querySelector("#smart-order-details");
      const isExpanded = !details.hidden;
      details.hidden = isExpanded;
      button.setAttribute("aria-expanded", String(!isExpanded));
      if (!isExpanded) {
        homeScreen.querySelector(".smart-order-full").hidden = false;
        homeScreen.querySelector(".smart-order-active").hidden = true;
      }
      break;
    }
    case "show-shortages":
      homeScreen.querySelector(".smart-order-full").hidden = true;
      homeScreen.querySelector(".smart-order-active").hidden = false;
      break;
    case "collect-order":
      homeProducts.filter((product) => product.recommended).forEach((product) => {
        product.quantity = Math.max(1, product.quantity);
      });
      renderHomeProducts();
      showHomeNotice("Рекомендации добавлены в демо-корзину.");
      break;
    case "notifications":
      openNotificationCenter();
      break;
    case "close-notifications":
      closeNotificationCenter();
      break;
    case "scan":
      showHomeNotice("Сканирование товаров пока не подключено.");
      break;
    case "back-to-catalog":
      activeDetailProductId = null;
      productDetailView.hidden = true;
      catalogView.hidden = false;
      renderCatalogProducts();
      break;
    case "add-detail-to-cart": {
      const product = homeProducts.find((item) => item.id === activeDetailProductId);
      product.quantity += detailQuantity;
      activeDetailProductId = null;
      renderHomeProducts();
      renderCatalogProducts();
      setHomeTab("cart");
      showHomeNotice("Товар добавлен в демонстрационную корзину.");
      break;
    }
    case "checkout":
      placeDemoOrder();
      break;
    case "open-orders":
      setHomeTab("orders");
      break;
    case "profile-back":
      profileSubview.hidden = true;
      profileOverview.hidden = false;
      homeScreen.classList.remove("is-profile-subview");
      renderProfile();
      break;
    case "choose-profile-photo":
      profilePhotoInput.click();
      break;
    case "logout":
      showLogin();
      break;
    default:
      break;
  }
});

password.addEventListener("input", validatePasswordConfirm);
passwordConfirm.addEventListener("input", validatePasswordConfirm);
recoveryPassword.addEventListener("input", validateRecoveryPasswordConfirm);
recoveryPasswordConfirm.addEventListener("input", validateRecoveryPasswordConfirm);
recoveryPassword.addEventListener("input", updatePasswordStrength);

[form, loginPanel, resetPasswordPanel, newPasswordPanel].forEach((currentForm) => {
  currentForm.addEventListener("input", () => {
    updateAriaValidity(currentForm);
    if (
      formStatus.classList.contains("is-error") ||
      !phoneScreen.matches(".is-reset, .is-code, .is-new-password")
    ) {
      clearFormStatus();
    }
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm(form)) {
    return;
  }
  setFormStatus("Данные проверены. Отправка регистрации пока не подключена.");
});

loginPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm(loginPanel)) {
    return;
  }
  showShopHome();
});

resetPasswordPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm(resetPasswordPanel)) {
    return;
  }
  showVerification();
  setFormStatus("Предпросмотр: SMS не отправлена — сервис отправки пока не подключён.");
});

const updateCodeInputValidity = () => {
  if (verificationPanel.classList.contains("was-validated")) {
    codeInputs.forEach((input) => {
      input.setAttribute("aria-invalid", String(!input.value));
    });
  }
  if (formStatus.classList.contains("is-error")) {
    clearFormStatus();
  }
};

codeInputs.forEach((input, index) => {
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "")
      .slice(0, codeInputs.length - index);
    [...digits].forEach((digit, offset) => {
      codeInputs[index + offset].value = digit;
    });
    input.value = digits[0] || "";
    const nextInput = codeInputs[index + digits.length];
    if (digits && nextInput) {
      nextInput.focus();
    }
    updateCodeInputValidity();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Backspace" && !input.value && codeInputs[index - 1]) {
      codeInputs[index - 1].focus();
    }
  });

  input.addEventListener("paste", (event) => {
    event.preventDefault();
    const digits = event.clipboardData.getData("text").replace(/\D/g, "")
      .slice(0, codeInputs.length - index);
    [...digits].forEach((digit, offset) => {
      codeInputs[index + offset].value = digit;
    });
    const nextIndex = Math.min(index + digits.length, codeInputs.length - 1);
    codeInputs[nextIndex].focus();
    updateCodeInputValidity();
  });
});

verificationPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  verificationPanel.classList.add("was-validated");
  updateCodeInputValidity();
  const firstEmpty = codeInputs.find((input) => !input.value);
  if (firstEmpty) {
    setFormStatus("Введите все 4 цифры кода.", "error");
    firstEmpty.focus();
    return;
  }
  showNewPassword();
  setFormStatus("Предпросмотр: код не проверяется — SMS-сервис не подключён.");
});

newPasswordPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm(newPasswordPanel)) {
    return;
  }
  showLogin();
  setFormStatus("Предпросмотр: пароль не изменён — сервис восстановления не подключён.");
});
