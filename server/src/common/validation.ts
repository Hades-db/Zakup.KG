import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

/** Названия полей для сообщений об ошибках — клиент показывает их пользователю как есть */
const LABEL: Record<string, string> = {
  phone: 'номер телефона', password: 'пароль', oldPassword: 'текущий пароль', newPassword: 'новый пароль', device: 'устройство',
  refreshToken: 'токен', type: 'тип компании', name: 'название', inn: 'ИНН / ПИН', address: 'адрес', ownerName: 'имя владельца',
  acceptedDocs: 'согласие с условиями', deliveryDate: 'дата поставки', courierId: 'доставщик', outLines: 'позиции «нет в наличии»',
  agreedLater: 'согласие магазина на другой срок', reason: 'причина', qr: 'QR-код', paid: 'оплата', stars: 'оценка', comment: 'комментарий',
  body: 'сообщение', qty: 'количество', urgent: 'срочно',
};

function flat(errors: ValidationError[], out: string[] = []) {
  for (const e of errors) {
    const c = e.constraints || {};
    if (c.whitelistValidation) out.push(`лишнее поле «${e.property}»`);
    else if (Object.keys(c).length) {
      const custom = Object.values(c).find(m => /[а-яё]/i.test(m));        // своё сообщение из декоратора
      out.push(custom || LABEL[e.property] || e.property);
    }
    if (e.children?.length) flat(e.children, out);
  }
  return out;
}

export const validationPipe = new ValidationPipe({
  whitelist: true, forbidNonWhitelisted: true, transform: true,
  exceptionFactory: errors => new BadRequestException('Проверьте: ' + [...new Set(flat(errors))].join(', ')),
});
