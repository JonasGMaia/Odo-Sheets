    import { chromium } from 'playwright';
    import { createClient } from '@supabase/supabase-js';
    import dotenv from 'dotenv';

    dotenv.config();

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // Função auxiliar para fazer o robô "dormir" por X milissegundos
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function processarLinksPendentes() {
    // Busca 1 hospedagem sem título
    const { data: pendentes, error: fetchError } = await supabase
        .from('accommodations')
        .select('*')
        .is('title', null)
        .limit(1);

    if (fetchError || !pendentes || pendentes.length === 0) {
        return false; // Retorna falso indicando que não achou nada para fazer
    }

    const hospedagem = pendentes[0];
    console.log(`\n🌐 Novo link encontrado! Acessando: ${hospedagem.url}`);

    const browser = await chromium.launch({ headless: true }); 
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto(hospedagem.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000); 

        console.log('🕵️ Extraindo dados básicos...');
        
        let title = 'Título não encontrado';
        try { title = await page.locator('h1').first().innerText(); } catch (e) {}

        let priceNumber = null;
        try {
            const priceText = await page.locator('*:has-text("R$")').filter({ hasNot: page.locator('*:has-text("R$") > *') }).first().innerText();
            const priceClean = priceText.replace(/[^\d,]/g, '').replace(',', '.');
            if (priceClean) priceNumber = parseFloat(priceClean);
        } catch (e) {}

        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(1000);

        try {
            const btnComodidades = page.locator('button:has-text("comodidades"), button:has-text("amenities"), button:has-text("Mostrar mais")').first();
            if (await btnComodidades.isVisible()) {
                await btnComodidades.click();
                await page.waitForTimeout(2000); 
            }
        } catch (e) {}

        const pageText = await page.locator('body').innerText();
        const text = pageText.toLowerCase();

        const wifi = text.includes('wi-fi') || text.includes('wifi') || text.includes('internet');
        const tv = text.includes('tv') || text.includes('televisão');
        const air_conditioning = text.includes('ar-condicionado') || text.includes('ar condicionado');
        const kitchen = text.includes('cozinha');
        const petfriendly = text.includes('permite animais') || text.includes('aceita pets') || text.includes('animais de estimação permitidos');

        const extractNumber = (regex) => {
            const match = text.match(regex);
            return match ? parseInt(match[1]) : null;
        };

        const bedrooms = extractNumber(/(\d+)\s*(quartos?|cômodos?)/);
        const beds = extractNumber(/(\d+)\s*(camas?)/);
        const bathrooms = extractNumber(/(\d+)\s*(banheiros?|casas? de banho)/);
        const parking = text.includes('estacionamento') || text.includes('vaga') ? 1 : null; 

        console.log('💾 Salvando no Supabase...');
        await supabase
        .from('accommodations')
        .update({ title, price: priceNumber, bedrooms, beds, bathrooms, wifi, tv, air_conditioning, kitchen, petfriendly, parking })
        .eq('id', hospedagem.id);

        console.log('🎉 Finalizado com sucesso!');
        return true; // Retorna verdadeiro indicando que processou um link

    } catch (erro) {
        console.error('❌ Erro durante a raspagem:', erro);
        
        // Se der erro (ex: link quebrado), preenchemos o título para ele sair da fila de "pendentes"
        await supabase.from('accommodations').update({ title: 'Erro ao ler link' }).eq('id', hospedagem.id);
        return true; 
    } finally {
        await browser.close();
    }
    }

    // --- O LOOP DE TAREFAS (Versão GitHub Actions) ---
    async function iniciarMotor() {
    console.log('🤖 Robô ligado pelo GitHub Actions! Verificando fila...');
    
    let temTrabalho = true;
    
    // Fica processando até a fila esvaziar
    while (temTrabalho) {
        temTrabalho = await processarLinksPendentes();
        if (temTrabalho) {
        await sleep(2000); // Pausa breve entre um link e outro
        }
    }
    
    console.log('🏁 Todos os links pendentes foram processados. Desligando...');
    process.exit(0); // Força o desligamento para não gastar minutos extras
    }

    iniciarMotor();